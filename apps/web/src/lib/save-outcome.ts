/** VOICE_UNAVAILABLE is an explicit pre-write refusal in project/settings
 * saves. Other 5xx/transport failures may have committed and must replay. */
export function canCorrectSaveFailure(status:number,code:unknown){return status>=400&&status<500&&status!==401||status===503&&code==='VOICE_UNAVAILABLE';}
