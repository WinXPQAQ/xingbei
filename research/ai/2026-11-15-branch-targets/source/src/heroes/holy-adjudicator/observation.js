export default {
  sins: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  noSins: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  form: {
    type: "enum",
    visibility: "public",
    default: null,
  },
  reckoningUsed: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  leftScaleId: {
    type: "card",
    visibility: "public",
    default: null,
  },
  rightScaleId: {
    type: "card",
    visibility: "public",
    default: null,
  },
};
