// Screenshot harness mock: only what the ProModal tree touches.
export const subscription = {
  getStatus: async () => ({ data: { trial_eligible: false } }),
  create: async () => { throw new Error('not in harness'); },
};
export const featureInterest = {
  get: async () => ({ data: {} }),
  register: async () => ({ data: {} }),
};
export default {};
