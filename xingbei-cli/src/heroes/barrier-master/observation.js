export default {
  ritual: {
    type: "number",
    visibility: "public",
    default: 0,
  },
  form: {
    type: "enum",
    visibility: "public",
    default: null,
  },
  realmCardId: {
    type: "card",
    visibility: "public",
    default: null,
  },
};
