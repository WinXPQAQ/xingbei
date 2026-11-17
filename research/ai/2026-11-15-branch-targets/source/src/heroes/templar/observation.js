export default {
  holySeals: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  form: {
    type: "enum",
    visibility: "public",
    default: null,
  },
  awaitNextTurn: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  divineMightBlocked: {
    type: "boolean",
    visibility: "public",
    default: false,
  },
  healingBlockedIds: {
    type: "players",
    visibility: "public",
    default: [],
  },
};
