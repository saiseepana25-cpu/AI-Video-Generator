'use strict';
const $ = (id) => document.getElementById(id);
const escape = (text) => String(text).replace(/[&<>"']/g, (character) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character]));
let state, current = null, dirty = false, busy = false, refreshing = false, selectedVideo = null, librarySignature = '';
const language = (value) => value === 'te' ? 'Telugu' : 'English';
async function api(route, data) {
  const response = await fetch(route, data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json', 'X-VideoCraft-Local': '1'}, body: JSON.stringify(data)});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}
function showError(error) {$('error').textContent = error.message; $('error').hidden = false; $('error').scrollIntoView({block: 'nearest', behavior: 'smooth'});}
function clearError() {$('error').hidden = true;}
function markDirty() {dirty = true; $('approve').checked = false; $('save-status').textContent = 'Unsaved changes · approval reset'; updateButtons();}
function voiceNote() {
  const selected = language($('spoken').value);
  $('caption-note').textContent = `${selected} narration with ${selected} subtitles.`;
  $('voice-note').textContent = current?.settings.mode === 'offline' ? 'Offline mode uses robotic diagnostic voices. Accent preference is saved for live narration and does not change this test voice.' : $('spoken').value === 'te' ? 'Telugu uses native Telugu delivery. The separate accent preference is retained for English narration.' : 'Gemini will be asked to use your chosen English accent. Human pronunciation review is required.';
}
function updateButtons() {
  const liveReady = state?.capabilities.geminiConfigured && state?.capabilities.freeTierConfirmed;
  const blockedLive = $('mode').value === 'gemini' && !liveReady;
  $('create').disabled = busy || Boolean(state?.active) || blockedLive;
  $('save').disabled = !current || !dirty || busy || Boolean(state?.active);
  $('generate').disabled = !current || dirty || busy || Boolean(state?.active) || !$('approve').checked || !state?.capabilities.remotionConfirmed || (current.settings.mode === 'gemini' && !liveReady);
}
function modeChanged() {
  const offline = $('mode').value === 'offline';
  $('sample-wrap').hidden = !offline; $('idea').readOnly = offline; $('template').disabled = offline;
  $('idea-help').textContent = offline ? 'Offline mode loads a curated lesson. Add a Gemini key to plan your own topic.' : 'Gemini creates an editable bilingual script and diagram plan. No video is generated until you approve it.';
  if (offline) topicChanged();
  updateButtons();
}
function topicChanged() {
  const water = $('topic').value === 'water-cycle';
  $('idea').value = water ? 'Explain the water cycle to a beginner, using a clear diagram.' : 'Explain how a seed germinates and becomes a young plant.';
  $('template').value = water ? 'water-cycle' : 'concept-flow';
}
function newPlan() {
  current = null; dirty = false; localStorage.removeItem('videocraft.project');
  $('idea-form').hidden = false; $('plan-section').hidden = true; $('job-section').hidden = true; clearError();
  $('idea-form').scrollIntoView({behavior: 'smooth', block: 'start'}); renderProjects(); updateButtons();
}
function selectProject(project, scroll = true) {
  if (!project) return;
  current = structuredClone(project); dirty = false;
  localStorage.setItem('videocraft.project', project.id);
  $('idea-form').hidden = true; $('plan-section').hidden = false;
  $('title-en').value = project.plan.title.en; $('title-te').value = project.plan.title.te;
  $('source').textContent = project.source === 'gemini' ? 'AI PLAN · REVIEW' : 'CURATED SAMPLE';
  $('scenes').innerHTML = project.plan.scenes.map((scene, index) => `<details ${index === 0 ? 'open' : ''}><summary>${String(index + 1).padStart(2, '0')} · ${escape(scene.label.en)}<span>${escape(project.plan.template === 'water-cycle' ? 'Illustrated phase' : 'Process diagram node')} · ${scene.phrases.length} narration phrases</span></summary><div class="scene-fields"><div class="two-fields"><div><label>English diagram label<input data-scene="${index}" data-label="en" maxlength="36" value="${escape(scene.label.en)}"></label></div><div><label>Telugu diagram label<input lang="te" data-scene="${index}" data-label="te" maxlength="44" value="${escape(scene.label.te)}"></label></div></div>${scene.phrases.map((phrase, phraseIndex) => `<div class="two-fields phrase"><div><label>English narration · ${phraseIndex + 1}<textarea rows="2" maxlength="140" data-scene="${index}" data-phrase="${phraseIndex}" data-language="en">${escape(phrase.text.en)}</textarea></label></div><div><label>Telugu narration · ${phraseIndex + 1}<textarea rows="2" lang="te" maxlength="200" data-scene="${index}" data-phrase="${phraseIndex}" data-language="te">${escape(phrase.text.te)}</textarea></label></div></div>`).join('')}</div></details>`).join('');
  for (const [id, key] of [['spoken', 'spoken'], ['accent', 'accent'], ['scale', 'scale']]) $(id).value = String(project.settings[key]);
  $('save-status').textContent = `${project.plan.targetSeconds}s plan · all changes saved`;
  $('approve').checked = false; voiceNote(); renderProjects(); renderJob(); updateButtons();
  const output = [...(state?.library || [])].reverse().find((video) => video.projectId === project.id);
  if (output) showVideo(output);
  if (scroll) $('plan-section').scrollIntoView({block: 'start', behavior: 'smooth'});
}
function renderProjects() {
  $('project-count').textContent = state?.projects.length || 0;
  $('projects').replaceChildren();
  for (const project of state?.projects || []) {
    const button = document.createElement('button'); button.className = 'project' + (current?.id === project.id ? ' active' : ''); button.textContent = project.plan.title.en; button.title = project.plan.title.en;
    button.addEventListener('click', () => {if (dirty && !confirm('Discard unsaved changes and open this plan?')) return; selectProject(project);}); $('projects').append(button);
  }
}
function showVideo(video) {
  selectedVideo = video.url;
  $('player').src = video.url; $('player').poster = video.poster; $('player').hidden = false; $('empty-preview').hidden = true;
  const project = state?.projects.find((item) => item.id === video.projectId);
  $('video-title').textContent = video.title?.en || project?.plan.title.en || 'The water cycle';
  const [spoken, captions] = video.pair.split('-');
  $('preview-label').textContent = video.mode === 'offline' ? 'OFFLINE SAMPLE' : 'AI NARRATION';
  $('video-description').textContent = `${language(spoken)} voice → ${language(captions)} captions · ${Math.round(video.media.durationSeconds)}s · ${video.media.width}p`;
  $('download').href = video.url + '?download=1'; $('captions-download').href = video.captionsUrl + '?download=1';
  $('download').hidden = false; $('captions-download').hidden = false;
}
function renderLibrary() {
  const videos = state.library;
  const signature = JSON.stringify(videos.map((video) => [video.url, video.media.durationSeconds]));
  if (signature === librarySignature) return; librarySignature = signature;
  $('video-count').textContent = `${videos.length} VIDEOS`; $('videos').replaceChildren();
  for (const video of [...videos].reverse()) {
    const [spoken, captions] = video.pair.split('-');
    const project = state.projects.find((item) => item.id === video.projectId);
    const button = document.createElement('button'); button.className = 'video-card'; button.setAttribute('aria-label', `Preview ${project?.plan.title.en || 'water cycle'}, ${language(spoken)} voice and ${language(captions)} captions`);
    button.innerHTML = `<div class="thumb"><img loading="lazy" src="${escape(video.poster)}" alt="Diagram frame"><span class="play">▶</span></div><div class="video-info"><b>${escape(video.title?.en || project?.plan.title.en || 'The water cycle')}</b><p>${language(spoken)} → ${language(captions)} · ${Math.round(video.media.durationSeconds)}s · ${video.media.width}p<br>${video.mode === 'offline' ? 'Offline test voice' : video.mode === 'elevenlabs' ? escape(video.narrator || 'ElevenLabs') + ' · ElevenLabs' : 'Gemini narration'}</p></div>`;
    button.addEventListener('click', () => {showVideo(video); $('player').scrollIntoView({behavior: 'smooth', block: 'center'});}); $('videos').append(button);
  }
  if (videos.length && (!selectedVideo || !videos.some((video) => video.url === selectedVideo))) showVideo(videos.at(-1));
  if (!videos.length) {$('player').hidden = true; $('empty-preview').hidden = false; $('download').hidden = true; $('captions-download').hidden = true;}
}
function renderJob() {
  const project = current && state?.projects.find((item) => item.id === current.id);
  const job = project?.jobs.at(-1);
  $('job-section').hidden = !job;
  if (!job) return;
  $('job-title').textContent = job.status === 'complete' ? 'Your video is ready' : job.status === 'rendering' ? 'Creating your video' : 'The render needs attention';
  $('job-description').textContent = job.status === 'complete' ? 'Media checks passed. Review the voice, captions, and explanation before sharing.' : job.status === 'rendering' ? 'Narration → timing → motion graphics → MP4 validation. You can keep this page open.' : job.failure || 'Retry by reviewing and approving the plan again. Earlier versions remain available.';
  $('logs').textContent = job.logs.join('\n');
  const progress = [...job.logs].reverse().map((line) => line.match(/:\s*(\d+)%/)).find(Boolean);
  $('progress').style.width = (job.status === 'complete' ? 100 : progress ? Math.min(95, 20 + Number(progress[1]) * .75) : 10) + '%';
  if (job.status === 'complete') {
    const video = state.library.find((item) => item.jobId === job.id);
    if (video && selectedVideo !== video.url && job.id !== current.lastSeenJob) {showVideo(video); current.lastSeenJob = job.id;}
  }
}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    state = await api('/api/state');
    const ready = state.capabilities.geminiConfigured && state.capabilities.freeTierConfirmed;
    $('notice').textContent = ready ? 'Live Gemini is configured. Offline testing is also available. All outputs are saved on this computer.' : 'You can test the entire local render flow now with sample lessons and robotic speech. Live AI needs a Gemini free-tier key in .env.local.';
    if (!state.capabilities.remotionConfirmed) $('notice').textContent += ' Confirm Remotion license eligibility in .env.local before rendering.';
    renderProjects(); renderLibrary(); renderJob(); updateButtons();
  } catch (error) {showError(error);} finally {refreshing = false;}
}
$('mode').addEventListener('change', modeChanged); $('topic').addEventListener('change', topicChanged);
$('new-project').addEventListener('click', () => {if (dirty && !confirm('Discard unsaved changes and start a new plan?')) return; newPlan();});
const another = document.createElement('button'); another.className = 'secondary'; another.textContent = 'New plan'; another.addEventListener('click', () => {if (dirty && !confirm('Discard unsaved changes and start a new plan?')) return; newPlan();}); $('plan-section').querySelector('.card-heading').append(another);
$('idea-form').addEventListener('submit', async (event) => {
  event.preventDefault(); clearError(); busy = true; $('create').textContent = 'Preparing plan…'; updateButtons();
  try {
    const project = await api('/api/projects', {idea: $('idea').value, topic: $('topic').value, template: $('template').value, duration: Number($('duration').value), settings: {mode: $('mode').value, spoken: 'en', accent: 'Indian', scale: .5}});
    await refresh(); selectProject(project);
  } catch (error) {showError(error);} finally {busy = false; $('create').textContent = 'Prepare my plan →'; updateButtons();}
});
$('plan-section').addEventListener('input', (event) => {
  if (!current) return; const input = event.target;
  if (input.id === 'approve') {updateButtons(); return;}
  if (input.id === 'title-en' || input.id === 'title-te') current.plan.title[input.id.endsWith('en') ? 'en' : 'te'] = input.value;
  else if (input.dataset.scene !== undefined) {
    const scene = current.plan.scenes[Number(input.dataset.scene)];
    if (input.dataset.label) scene.label[input.dataset.label] = input.value;
    else scene.phrases[Number(input.dataset.phrase)].text[input.dataset.language] = input.value;
  } else if (['spoken', 'accent', 'scale'].includes(input.id)) {
    current.settings[input.id] = input.id === 'scale' ? Number(input.value) : input.value;
  } else return;
  markDirty(); voiceNote();
});
$('save').addEventListener('click', async () => {
  clearError(); busy = true; updateButtons();
  try {
    const project = await api(`/api/projects/${current.id}/save`, {plan: current.plan, settings: current.settings, previousHash: current.versionHash});
    current = project; dirty = false; $('approve').checked = false; $('save-status').textContent = 'All changes saved · review before generating'; await refresh();
  } catch (error) {showError(error);} finally {busy = false; updateButtons();}
});
$('generate').addEventListener('click', async () => {
  clearError(); busy = true; updateButtons();
  try {
    await api(`/api/projects/${current.id}/render`, {approvedHash: current.planHash, settingsHash: current.settingsHash});
    $('approve').checked = false; await refresh(); $('job-section').scrollIntoView({behavior: 'smooth', block: 'center'});
  } catch (error) {showError(error);} finally {busy = false; updateButtons();}
});
window.addEventListener('beforeunload', (event) => {if (dirty) {event.preventDefault(); event.returnValue = '';}});
(async () => {modeChanged(); await refresh(); const id = localStorage.getItem('videocraft.project'); if (id) selectProject(state?.projects.find((project) => project.id === id), false); setInterval(refresh, 1500);})();
