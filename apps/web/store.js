import { DatabaseSync } from "node:sqlite";
export function createStore(filename) {
  const db = new DatabaseSync(filename);
  db.exec(
    `CREATE TABLE IF NOT EXISTS submissions (id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, url TEXT NOT NULL, contact TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  );
  return {
    submit(input) {
      const data = {};
      for (const [key, max] of Object.entries({
        name: 80,
        description: 1200,
        url: 500,
        contact: 200,
      })) {
        if (
          typeof input[key] !== "string" ||
          !input[key].trim() ||
          input[key].length > max
        )
          throw Error(`Invalid ${key}`);
        data[key] = input[key].trim();
      }
      const url = new URL(data.url);
      if (url.protocol !== "https:" || url.username || url.password)
        throw Error("Use a public HTTPS project URL.");
      const result = db
        .prepare(
          "INSERT INTO submissions (name,description,url,contact) VALUES (?,?,?,?)",
        )
        .run(data.name, data.description, data.url, data.contact);
      return { id: Number(result.lastInsertRowid), status: "pending" };
    },
    public() {
      return db
        .prepare(
          "SELECT id,name,description,url FROM submissions WHERE status='approved'",
        )
        .all();
    },
    pending() {
      return db
        .prepare("SELECT * FROM submissions WHERE status='pending'")
        .all();
    },
    review(id, status) {
      if (!["approved", "rejected"].includes(status))
        throw Error("Expected approved or rejected");
      const r = db
        .prepare(
          "UPDATE submissions SET status=? WHERE id=? AND status='pending'",
        )
        .run(status, id);
      if (!r.changes) throw Error("Pending submission not found");
    },
    close() {
      db.close();
    },
  };
}
