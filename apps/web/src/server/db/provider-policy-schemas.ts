import {providerCollections} from './provider-schemas';

// Preserve migration 004 and legacy rows. New/updated rows persist this independent
// operator gate; absence still honors the legacy state:disabled kill switch.
export const providerPolicyCollections = structuredClone(providerCollections);
providerPolicyCollections[0].validator.$jsonSchema.properties.operatorDisabled = {bsonType: 'bool'};
