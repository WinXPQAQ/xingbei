export default {
  attacksCompleted: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  imaginaryUsed: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  severanceUsed: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  admiresWitch: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  oathHit: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  cupsAtStart: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  residualUsed: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  residualTarget: {
    type: "player",
    visibility: "public",
    default: null,
  },
};
