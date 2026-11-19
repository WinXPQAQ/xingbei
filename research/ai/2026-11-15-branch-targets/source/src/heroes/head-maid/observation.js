export default {
  threads: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  form: {
    type: "enum",
    visibility: "public",
    default: null,
  },
  flashUsed: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  flashActive: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  tunnelCardId: {
    type: "card",
    visibility: "public",
    default: null,
  },
  windHitCardId: {
    type: "card",
    visibility: "public",
    default: null,
  },
};
