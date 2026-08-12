/**
 * The definitions, without the engine.
 *
 * `@xpplab/virtual-db` proper reaches SQLite: importing it pulls in `sql.js`, which is a
 * WASM module and belongs in a Web Worker. But the schema, the base enums and the seed
 * *shapes* are plain data, and things that only need to know what a table looks like
 * should not have to drag a database engine along to find out.
 *
 * The AOT metadata model is the case in point. It derives its tables from `SCHEMA`, and
 * the Studio renders that model on the main thread — so without this entry point, opening
 * the Application Explorer would load SQLite into the browser bundle. It also fails the
 * production build outright, which is how this boundary got noticed.
 *
 * Import from here whenever you want the definitions. Import from the package root when
 * you actually want a database.
 */

export * from "./schema";
export * from "./enums";
export * from "./seeds/index";
