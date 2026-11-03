export default {
  relics: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  silverBullets: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  silverGraceUsed: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  orbCardId: {
    type: "card",
    visibility: "public",
    default: null,
  },
};
