export default {
  devotion: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  started: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  waypointCardId: {
    type: "card",
    visibility: "public",
    default: null,
  },
  confessedIds: {
    type: "players",
    visibility: "public",
    default: [],
  },
};
