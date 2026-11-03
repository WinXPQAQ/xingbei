export default {
  prophecyCardId: {
    type: "card",
    visibility: "public",
    default: null,
  },
  prophecyFace: {
    type: "enum",
    visibility: "owner",
    default: null,
  },
  revealedFace: {
    type: "enum",
    visibility: "public",
    default: null,
  },
  banishUsed: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  banishing: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  damagedEnemies: {
    type: "players",
    visibility: "public",
    default: [],
  },
};
