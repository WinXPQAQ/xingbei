export default {
  archives: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  ruinRebuttalUsed: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  bookCardId: {
    type: "card",
    visibility: "public",
    default: null,
  },
  castingCardId: {
    type: "card",
    visibility: "public",
    default: null,
  },
};
