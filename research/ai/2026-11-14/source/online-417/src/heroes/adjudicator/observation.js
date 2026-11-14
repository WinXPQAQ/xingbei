// Explicit visible state contract; an empty object means no persistent hero fields.
export default {
  "judgment": {
    "type": "number",
    "visibility": "public",
    "default": 0
  },
  "requiredJudgment": {
    "type": "boolean",
    "visibility": "public",
    "default": false
  },
  "form": {
    "type": "enum",
    "visibility": "public",
    "default": null
  }
};
