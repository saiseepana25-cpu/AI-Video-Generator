/** These named 503s are thrown before planning job/receipt writes, after replay.
 * Other server/transport failures can hide an accepted job and must keep its key. */
export function canCorrectPlanningFailure(status:number,code:unknown){
  return status>=400&&status<500&&status!==401||status===503&&(code==='WORKER_UNAVAILABLE'||code==='FREE_ALLOWANCE_UNAVAILABLE');
}
