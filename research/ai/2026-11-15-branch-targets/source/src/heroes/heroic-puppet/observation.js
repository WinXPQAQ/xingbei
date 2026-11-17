// Explicit visible state contract; an empty object means no persistent hero fields.
export default {
  "battleRunes": {
    "type": "number",
    "visibility": "public",
    "default": 0
  },
  "magicRunes": {
    "type": "number",
    "visibility": "public",
    "default": 0
  },
  "form": {
    "type": "enum",
    "visibility": "public",
    "default": null
  }
};
