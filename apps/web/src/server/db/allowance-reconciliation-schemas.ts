import type {CollectionContract} from './schemas';
const uuid={bsonType:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'},hash={bsonType:'string',pattern:'^[a-f0-9]{64}$'},units={bsonType:['int','long','double'],minimum:0,maximum:Number.MAX_SAFE_INTEGER},date={bsonType:'date'};
const obj=(properties:Record<string,unknown>)=>({bsonType:'object',additionalProperties:false,required:Object.keys(properties),properties});
export const allowanceReconciliationCollections:CollectionContract[]=[{name:'speech_allowance_reconciliations',validator:{$jsonSchema:obj({
  _id:uuid,requestHash:hash,configHash:hash,periodId:{bsonType:'string',minLength:1,maxLength:80},sourceRevision:{bsonType:'long',minimum:1,maximum:Number.MAX_SAFE_INTEGER},
  operatorConfirmedRemaining:units,providerRemaining:units,availableAfter:units,retainedUnits:units,observedAt:date,createdAt:date,
  reservations:{bsonType:'array',minItems:1,maxItems:100,items:obj({id:uuid,units,state:{enum:['settled']},createdAt:date,runId:uuid,runHash:hash,attemptsHash:hash})}
})},indexes:[{key:{'reservations.id':1},name:'speech_reconciled_reservation_v1',unique:true},{key:{configHash:1,createdAt:-1},name:'speech_reconciliation_config_v1'}]}];
