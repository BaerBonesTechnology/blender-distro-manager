import path from "node:path";
import { createStore } from "./store.js";
const db = createStore(
  path.resolve(process.env.BDM_DATA || ".data", "submissions.sqlite"),
);
try {
  const [action, id] = process.argv.slice(2);
  if (action === "approve" || action === "reject") {
    db.review(Number(id), action === "approve" ? "approved" : "rejected");
    console.log("Review saved.");
  } else console.table(db.pending());
} finally {
  db.close();
}
