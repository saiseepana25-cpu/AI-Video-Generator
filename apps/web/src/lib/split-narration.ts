/** Deterministic sentence-boundary split, shared by preview and server save.
 * No invented text, timing, diagram relationship or provider request. */
export function splitNarrationScenes<T extends {sceneId: string; narration: string}>(scenes: T[]): T[] {
  const next = scenes.flatMap(scene => {
    const boundary = /(?<=[.!?।])\s+/u.exec(scene.narration);
    if (!boundary) return [structuredClone(scene)];
    const before = scene.narration.slice(0, boundary.index).trim();
    const after = scene.narration.slice(boundary.index + boundary[0].length).trim();
    return before && after ? [{...structuredClone(scene), narration: before}, {...structuredClone(scene), narration: after}] : [structuredClone(scene)];
  });
  if (next.length === scenes.length) throw new Error('No sentence boundary was found. Add a sentence break before splitting.');
  if (next.length > 8) throw new Error('Splitting would exceed eight scenes. Shorten the plan or edit fewer long scenes first.');
  return next.map((scene, i) => ({...scene, sceneId: `scene_${i + 1}`}));
}
