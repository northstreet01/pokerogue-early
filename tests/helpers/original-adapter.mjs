import {createOriginalCoopAdapter as createAdapter} from '../../server/original-coop-adapter.mjs';
export {ADAPTER_FORMAT_VERSION,createPlayerHostAdapter} from '../../server/original-coop-adapter.mjs';

// Fixed parties are historical seam-test data, never a production default.
const fixture={seed:'vs01-original-coop',identities:[{trainerId:1,secretId:2},{trainerId:3,secretId:4}],
  parties:[[1,4,7],[906,909,912]],eggState:{players:[[],[]]}};
export function createOriginalCoopAdapter(options={}) { return createAdapter({fixture,...options}); }
