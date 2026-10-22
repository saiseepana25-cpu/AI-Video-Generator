import {generationCollections} from './generation-schemas';
import type {CollectionContract} from './schemas';
const member=structuredClone(generationCollections.find(c=>c.name==='memberships')!);
// Optional for existing memberships: reading an old row projects a null accent.
member.validator.$jsonSchema.properties.preferences.properties.accentId={oneOf:[{bsonType:'null'},{enum:['source-voice','en-IN','te-IN']}]};
const uuid={bsonType:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'};
const prefs=structuredClone(member.validator.$jsonSchema.properties.preferences);prefs.required.push('accentId');
export const preferencesCollections:CollectionContract[]=[member,{name:'member_preferences_commands',validator:{$jsonSchema:{bsonType:'object',additionalProperties:false,required:['_id','workspaceId','userId','keyHash','requestHash','snapshot','createdAt'],properties:{_id:uuid,workspaceId:uuid,userId:{bsonType:'string',pattern:'^[a-f0-9]{24}$'},keyHash:hash,requestHash:hash,snapshot:{bsonType:'object',additionalProperties:false,required:['revision','preferences'],properties:{revision:{bsonType:['int','double'],minimum:1,maximum:Number.MAX_SAFE_INTEGER},preferences:prefs}},createdAt:{bsonType:'date'}}}},indexes:[{key:{workspaceId:1,userId:1,keyHash:1},name:'member_preferences_replay_v1',unique:true}]}];
