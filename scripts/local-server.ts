import {config} from 'dotenv';
import http, {type IncomingMessage, type ServerResponse} from 'node:http';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {PlanSchema, Language, digest, type Plan} from '../src/pipeline/schema.js';
import {createGeminiPlan, requireFreeGemini} from '../src/pipeline/providers.js';

export const SettingsSchema = z.object({mode: z.enum(['offline', 'gemini']), spoken: Language, accent: z.enum(['Indian', 'Neutral']), scale: z.union([z.literal(0.5), z.literal(1)])}).strict();
type Settings = z.infer<typeof SettingsSchema>;
type Job = {id: string; status: 'rendering' | 'complete' | 'failed' | 'interrupted'; folder: string; planHash: string; settings: Settings; startedAt: string; logs: string[]; failure?: string; finishedAt?: string};
type Project = {id: string; idea: string; source: string; plan: Plan; settings: Settings; updatedAt: string; jobs: Job[]};
const idPattern = /^[a-f0-9-]{36}$/;
const readJson = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));
const saveJson = async (file: string, value: unknown) => {
  await fs.mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(temporary, file);
};
const cleanError = (error: unknown) => (error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') : error instanceof Error ? error.message : 'Unexpected local error').replaceAll(process.env.GEMINI_API_KEY || '__NO_KEY__', '[redacted]').slice(0, 1800);
const fail = (status: number, message: string): never => {throw Object.assign(new Error(message), {status});};
const mediaUrl = (root: string, file: string) => '/media/' + path.relative(path.join(root, 'output'), file).split(path.sep).map(encodeURIComponent).join('/');

export async function samplePlan(root: string, topic: 'water-cycle' | 'seed-growth', duration: 30 | 60 | 90): Promise<Plan> {
  const lessons = await readJson(path.join(root, 'fixtures/lessons.json'));
  const plan = topic === 'seed-growth' ? lessons.seedPlan : await readJson(path.join(root, 'fixtures/water-cycle.json'));
  if (topic === 'water-cycle') plan.scenes.forEach((scene: Plan['scenes'][number], i: number) => {
    scene.phrases.push(...lessons.waterExtras[i].map(([en, te]: string[], j: number) => ({id: `${scene.id}-extra-${j}`, text: {en, te}})));
  });
  plan.targetSeconds = duration;
  plan.scenes.forEach((scene: Plan['scenes'][number]) => {scene.phrases = scene.phrases.slice(0, duration / 15);});
  return PlanSchema.parse(plan);
}

export async function createLocalServer(root = process.cwd(), projectsDir = path.join(root, 'output/projects')) {
  await fs.mkdir(projectsDir, {recursive: true});
  const projects = new Map<string, Project>();
  for (const name of await fs.readdir(projectsDir)) {
    if (!idPattern.test(name)) continue;
    try {
      const project: Project = await readJson(path.join(projectsDir, name, 'project.json'));
      const {captions: _legacyCaptions, ...settings} = project.settings as Settings & {captions?: string};
      project.plan = PlanSchema.parse(project.plan); project.settings = SettingsSchema.parse(settings);
      if (project.id !== name) continue;
      for (const job of project.jobs) if (job.status === 'rendering') {job.status = 'interrupted'; job.failure = 'The local server stopped during this job. Review saved outputs and retry.';}
      projects.set(name, project);
      await saveJson(path.join(projectsDir, name, 'project.json'), project);
    } catch {console.warn(`Skipped an unreadable local project: ${name}`);}
  }
  let active: string | null = null;
  let mutating = false;
  const writes = new Map<string, Promise<void>>();
  const persist = (project: Project) => {
    // Preserve write order when a worker completes while a new edit is saved.
    const snapshot = structuredClone(project);
    const next = (writes.get(project.id) || Promise.resolve()).catch(() => undefined).then(() => saveJson(path.join(projectsDir, project.id, 'project.json'), snapshot));
    writes.set(project.id, next); return next;
  };
  const getProject = (id: string) => projects.get(id) || fail(404, 'Project not found.');
  const summary = (project: Project) => ({...project, planHash: digest(project.plan), settingsHash: digest(project.settings), versionHash: digest({plan: project.plan, settings: project.settings})});
  const legacyDir = path.join(root, 'output/offline-water-cycle');
  async function videosFor(folder: string, projectId: string | null, jobId: string | null) {
    try {
      const manifest = await readJson(path.join(folder, 'manifest.json'));
      return (manifest.videos || []).filter((video: {pair: string}) => ['en-en', 'te-te'].includes(video.pair)).map((video: {file: string; pair: string; captions: string; representativeFrames: string[]; media: unknown}) => ({...video, title: manifest.title, projectId, jobId, mode: manifest.mode, narrator: manifest.voiceChoice === "both" ? "Madhavi + Bharadwaj" : manifest.voices?.[manifest.voiceChoice]?.name, targetSeconds: manifest.targetSeconds || 30, url: mediaUrl(root, path.join(folder, video.file)), captionsUrl: mediaUrl(root, path.join(folder, video.captions)), poster: mediaUrl(root, path.join(folder, video.representativeFrames[1] || video.representativeFrames[0])), manifestUrl: mediaUrl(root, path.join(folder, 'manifest.json')), reusedSpeechClips: manifest.reusedSpeechClips || 0, speechRequests: manifest.speechRequests || 0}));
    } catch {return [];}
  }
  const server = http.createServer(async (request, response) => {
    let ownsMutation = false;
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (status: number, value: unknown) => {response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8'}); response.end(JSON.stringify(value));};
    try {
      const address = server.address();
      const host = `127.0.0.1:${typeof address === 'object' && address ? address.port : 4310}`;
      if (request.headers.host !== host) fail(403, 'Use the printed 127.0.0.1 local URL.');
      const url = new URL(request.url || '/', `http://${host}`);
      const pathname = decodeURIComponent(url.pathname);
      if (request.method === 'POST') {
        if (request.headers.origin && request.headers.origin !== `http://${host}`) fail(403, 'Cross-origin requests are not allowed.');
        if (request.headers['x-videocraft-local'] !== '1' || !request.headers['content-type']?.startsWith('application/json')) fail(403, 'Use the local application to submit JSON.');
        if (mutating) fail(409, 'Another change is being saved. Try again in a moment.');
        mutating = true; ownsMutation = true;
      }
      if (request.method === 'GET' && pathname === '/api/state') {
        const library = [...await videosFor(path.join(root, 'output/elevenlabs-water-cycle'), null, null), ...await videosFor(legacyDir, null, null)];
        for (const project of projects.values()) for (const job of project.jobs) library.push(...await videosFor(path.join(projectsDir, project.id, job.id), project.id, job.id));
        return json(200, {active, capabilities: {geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()), freeTierConfirmed: process.env.GEMINI_FREE_TIER_CONFIRMED === 'true', remotionConfirmed: process.env.REMOTION_FREE_LICENSE_CONFIRMED === 'true'}, projects: [...projects.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summary), library});
      }
      if (request.method === 'POST' && pathname === '/api/projects') {
        if (active) fail(409, 'One pipeline job is already running. Wait for it to finish.');
        const input = z.object({idea: z.string().trim().min(5).max(2000), topic: z.enum(['water-cycle', 'seed-growth']), template: z.enum(['water-cycle', 'concept-flow']), duration: z.union([z.literal(30), z.literal(60), z.literal(90)]), settings: SettingsSchema}).strict().parse(await body(request));
        active = 'planning';
        try {
          const plan = input.settings.mode === 'offline' ? await samplePlan(root, input.topic, input.duration) : await createGeminiPlan(input.idea, process.env, input.duration, input.template);
          const project: Project = {id: randomUUID(), idea: input.idea, source: input.settings.mode === 'offline' ? 'curated-sample-not-ai' : 'gemini', plan, settings: input.settings, updatedAt: new Date().toISOString(), jobs: []};
          await persist(project); projects.set(project.id, project); return json(201, summary(project));
        } finally {active = null;}
      }
      const match = pathname.match(/^\/api\/projects\/([a-f0-9-]{36})\/(save|render)$/);
      if (request.method === 'POST' && match) {
        const project = getProject(match[1]);
        if (active) fail(409, 'One pipeline job is already running. Wait for it to finish.');
        if (match[2] === 'save') {
          const input = z.object({plan: PlanSchema, settings: SettingsSchema, previousHash: z.string()}).strict().parse(await body(request));
          if (input.previousHash !== digest({plan: project.plan, settings: project.settings})) fail(409, 'This plan changed in another tab. Reload before saving.');
          project.plan = input.plan; project.settings = input.settings; project.updatedAt = new Date().toISOString();
          await persist(project); return json(200, summary(project));
        }
        const input = z.object({approvedHash: z.string(), settingsHash: z.string()}).strict().parse(await body(request));
        if (input.approvedHash !== digest(project.plan) || input.settingsHash !== digest(project.settings)) fail(409, 'Approval is stale. Review the current plan and settings first.');
        if (process.env.REMOTION_FREE_LICENSE_CONFIRMED !== 'true') fail(422, 'Confirm Remotion free-license eligibility in .env.local, then restart the server.');
        if (project.settings.mode === 'gemini') requireFreeGemini(process.env);
        const job: Job = {id: randomUUID(), status: 'rendering', folder: '', planHash: digest(project.plan), settings: {...project.settings}, startedAt: new Date().toISOString(), logs: ['Preparing approved plan…']};
        const folder = path.join(projectsDir, project.id, job.id); job.folder = path.relative(path.join(root, 'output'), folder);
        await saveJson(path.join(folder, 'approved-plan.json'), project.plan);
        project.jobs.push(job); project.updatedAt = job.startedAt; await persist(project); active = job.id;
        try {
          const child = spawn(process.execPath, ['--import', 'tsx', path.join(root, 'scripts/cli.ts'), 'render', '--mode', job.settings.mode, '--plan', path.join(folder, 'approved-plan.json'), '--out', folder, '--spoken', job.settings.spoken, '--accent', job.settings.accent, '--scale', String(job.settings.scale), '--approve'], {cwd: root, env: process.env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']});
          let pending = '';
          const logs = (chunk: Buffer) => {pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop() || ''; job.logs.push(...lines.filter(Boolean).map((line) => cleanError(new Error(line)))); job.logs = job.logs.slice(-24);};
          child.stdout.on('data', logs); child.stderr.on('data', logs);
          let settled = false;
          const finish = async (error?: string) => {
            if (settled) return; settled = true;
            job.status = error ? 'failed' : 'complete'; job.failure = error; job.finishedAt = new Date().toISOString();
            if (pending) job.logs.push(cleanError(new Error(pending)));
            active = null;
            try {await persist(project);} catch (failure) {console.error(cleanError(failure));}
          };
          child.on('error', (error) => {void finish(cleanError(error));});
          child.on('close', (code) => {void finish(code === 0 ? undefined : job.logs.at(-1) || `Renderer exited with code ${code}.`);});
          return json(202, summary(project));
        } catch (error) {active = null; job.status = 'failed'; job.failure = cleanError(error); await persist(project); throw error;}
      }
      if (request.method === 'GET' || request.method === 'HEAD') {
        if (pathname.startsWith('/media/')) {
          const base = await fs.realpath(path.join(root, 'output'));
          const file = path.resolve(base, pathname.slice(7));
          if (!file.startsWith(base + path.sep)) fail(403, 'Invalid media path.');
          const resolved = await fs.realpath(file);
          if (!resolved.startsWith(base + path.sep) || !/\.(mp4|wav|srt|png|json)$/i.test(file)) fail(403, 'Invalid media path.');
          return await streamFile(request, response, resolved, url.searchParams.has('download'));
        }
        const assets: Record<string, string> = {'/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css'};
        if (assets[pathname]) return await streamFile(request, response, path.join(root, 'src/local', assets[pathname]));
        const fontFiles: Record<string, string> = {'/fonts/english.woff2': '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff2', '/fonts/telugu.woff2': '@fontsource/noto-sans-telugu/files/noto-sans-telugu-telugu-400-normal.woff2'};
        if (fontFiles[pathname]) return await streamFile(request, response, path.join(root, 'node_modules', fontFiles[pathname]));
      }
      json(404, {error: 'Local resource not found.'});
    } catch (error) {
      if (response.headersSent) {response.destroy(); return;}
      const status = (error as {status?: number; code?: string}).status || (error instanceof z.ZodError ? 400 : (error as {code?: string}).code === 'ENOENT' ? 404 : 422);
      json(status, {error: cleanError(error)});
    } finally {if (ownsMutation) mutating = false;}
  });
  return server;
}

async function body(request: IncomingMessage) {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of request) {size += chunk.length; if (size > 120000) fail(413, 'Request is too large.'); chunks.push(chunk);}
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {return fail(400, 'Invalid JSON.');}
}
async function streamFile(request: IncomingMessage, response: ServerResponse, file: string, download = false) {
  const stat = await fs.stat(file); if (!stat.isFile()) fail(404, 'File not found.');
  const mime: Record<string, string> = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.srt': 'application/x-subrip; charset=utf-8', '.woff2': 'font/woff2'};
  response.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  response.setHeader('Accept-Ranges', 'bytes');
  if (download) response.setHeader('Content-Disposition', `attachment; filename="${path.basename(file).replaceAll('"', '')}"`);
  let start = 0, end = stat.size - 1;
  if (request.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
    if (!match || (!match[1] && !match[2])) {response.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); response.end(); return;}
    start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {response.writeHead(416, {'Content-Range': `bytes */${stat.size}`}); response.end(); return;}
    response.statusCode = 206; response.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
  }
  response.setHeader('Content-Length', end - start + 1);
  if (request.method === 'HEAD') {response.end(); return;}
  const stream = createReadStream(file, {start, end}); stream.on('error', () => response.destroy()); stream.pipe(response);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  config({path: '.env.local', quiet: true} as Parameters<typeof config>[0]);
  const port = Number(process.env.PORT || 4310);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be between 1024 and 65535.');
  const server = await createLocalServer();
  server.on('error', (error) => {console.error(cleanError(error)); process.exitCode = 1;});
  server.listen(port, '127.0.0.1', () => console.log(`VideoCraft local prototype: http://127.0.0.1:${port}\nLocal files only. Offline samples need no API key. Keep this terminal open.`));
}
