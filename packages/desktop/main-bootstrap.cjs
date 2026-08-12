const e = require("electron");
console.log("typeof electron:", typeof e);
console.log("value:", typeof e === "string" ? e : Object.keys(e).slice(0,5));
process.exit(0);
