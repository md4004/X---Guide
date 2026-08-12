import { expect, test, type Page } from "@playwright/test";

/**
 * The Studio in the browser.
 *
 * The engine-side proof lives in `packages/xpp-runtime/test/debug.test.ts` and
 * `packages/virtual-aot/test/designer.test.ts`, which assert where the debugger stops and
 * what the designers contain. This covers what those cannot: that the panes render, that a
 * breakpoint set in Monaco's margin actually stops a run in the worker, and that the
 * refusal a learner meets when they try to edit from Application Explorer is the one the
 * real tool would give them.
 */

const STUDIO = "/studio";

/** The editor is behind an ssr:false boundary and loads its own chunk. */
async function openStudio(page: Page) {
  await page.goto(STUDIO);
  await expect(page.getByTestId("studio-status")).toHaveText("Ready");
  await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
}

/** Clicks the glyph margin next to a line, which is how most people set a breakpoint. */
async function setBreakpoint(page: Page, lineText: string) {
  const line = page.locator(".view-line", { hasText: lineText }).first();
  await expect(line).toBeVisible();

  const box = await line.boundingBox();
  if (box === null) throw new Error(`No box for the line containing ${lineText}`);

  // The glyph margin sits to the left of the text, inside the editor's own left edge.
  const editor = page.locator(".monaco-editor").first();
  const editorBox = await editor.boundingBox();
  if (editorBox === null) throw new Error("No box for the editor");

  await page.mouse.click(editorBox.x + 10, box.y + box.height / 2);
}

test.describe("Application Explorer", () => {
  test("shows the AOT under its real top-level nodes", async ({ page }) => {
    await openStudio(page);

    for (const folder of ["Data Model", "Data Types", "Code", "User Interface", "Analytics"]) {
      await expect(page.getByTestId(`tree-node-AOT/${folder}`)).toBeVisible();
    }
  });

  test("filters the tree without collapsing its shape", async ({ page }) => {
    await openStudio(page);

    await page.getByTestId("aot-filter").fill("custtable");

    await expect(page.getByTestId("tree-node-AOT/Data Model/Tables/CustTable")).toBeVisible();
    await expect(page.getByTestId("tree-node-AOT/Data Model/Tables/InventTable")).toHaveCount(0);
    // The folders survive the filter, so you can still see where a match lives.
    await expect(page.getByTestId("tree-node-AOT/User Interface")).toBeVisible();
  });

  test("opens an element designer on double-click, with the table's own nodes", async ({
    page,
  }) => {
    await openStudio(page);

    await page.getByTestId("tree-node-AOT/Data Model/Tables/InventTable").dblclick();

    await expect(page.getByTestId("tab-designer")).toContainText("InventTable");
    for (const node of ["Fields", "Field Groups", "Indexes", "Relations", "Methods"]) {
      await expect(page.getByTestId(`tree-node-InventTable/${node}`)).toBeVisible();
    }
  });
});

test.describe("the Properties window", () => {
  test("shows a field's EDT and jumps to it", async ({ page }) => {
    await openStudio(page);

    await page.getByTestId("tree-node-AOT/Data Model/Tables/InventTable").dblclick();
    await page.getByTestId("tree-node-InventTable/Fields/ItemId").click();

    const properties = page.getByTestId("properties-window");
    await expect(properties).toContainText("Extended Data Type");
    // The string size comes from the EDT, which is the reason to use one at all.
    await expect(properties).toContainText("20 (from ItemId)");

    await page.getByTestId("property-goto-Extended Data Type").click();
    await expect(page.getByTestId("tab-designer")).toContainText("ItemId");
  });

  test("reorders on the pane's own buttons", async ({ page }) => {
    await openStudio(page);
    await page.getByTestId("tree-node-AOT/Data Model/Tables/InventTable").dblclick();

    await page.getByTestId("properties-ordering-Categorized").click();
    await expect(page.getByTestId("properties-window")).toContainText("Appearance");

    await page.getByTestId("properties-ordering-Changed").click();
    await expect(page.getByTestId("properties-window")).toContainText("Changed");
  });
});

test.describe("a project is what makes an element editable", () => {
  test("refuses to add a field to a table that is not in the project", async ({ page }) => {
    // VB-015, the fact newcomers lose hours to.
    await openStudio(page);

    await page.getByTestId("tree-node-AOT/Data Model/Tables/InventTable").dblclick();
    await page.getByTestId("designer-add-field").click();

    await expect(page.getByTestId("error-list")).toContainText("read-only");
    await expect(page.getByTestId("studio-status")).toContainText("Add to project");
  });

  test("carries the real commands on the element's right-click menu", async ({ page }) => {
    await openStudio(page);

    await page
      .getByTestId("tree-node-AOT/Data Model/Tables/InventTable")
      .click({ button: "right" });

    const menu = page.getByTestId("context-menu");
    await expect(menu).toBeVisible();
    for (const command of ["Open designer", "View code", "Add to project", "Create extension"]) {
      await expect(page.getByTestId(`context-${command}`)).toBeVisible();
    }
    // What we do not implement stays on the menu, disabled, rather than being hidden.
    await expect(page.getByTestId("context-Create extension")).toBeDisabled();
  });

  test("adds the field once the table is in the project, and synchronises it", async ({ page }) => {
    await openStudio(page);

    await page
      .getByTestId("tree-node-AOT/Data Model/Tables/InventTable")
      .click({ button: "right" });
    await page.getByTestId("context-Add to project").click();
    await expect(page.getByTestId("tree-node-project/InventTable")).toBeVisible();

    await page.getByTestId("tree-node-AOT/Data Model/Tables/InventTable").dblclick();
    await page.getByTestId("designer-add-field").click();

    await expect(page.getByTestId("tree-node-InventTable/Fields/NewField7")).toBeVisible();
    await expect(page.getByTestId("studio-status")).toContainText("the database does not");

    // The metadata changed; the database has not, until this command runs.
    await page.getByTestId("menu-Dynamics 365").click();
    await page.getByTestId("menu-item-Synchronize database").click();
    await expect(page.getByTestId("output-pane")).toContainText(
      "ALTER TABLE InventTable ADD NewField7 TEXT",
    );
  });

  test("reports the real build steps, and is honest about the ones it skips", async ({ page }) => {
    await openStudio(page);

    await page.getByTestId("menu-Build").click();
    await page.getByTestId("menu-item-Build XppLabTutorial").click();

    const output = page.getByTestId("output-pane");
    await expect(output).toContainText("Metadata validation");
    await expect(output).toContainText("Best practice checks");
    await expect(output).toContainText("Compilation and IL generation... (not simulated");
  });
});

test.describe("the debugger", () => {
  test("stops at a breakpoint and shows the state the real windows show", async ({ page }) => {
    await openStudio(page);

    await setBreakpoint(page, "inventTable.update();");
    await page.getByTestId("bottom-tab-breakpoints").click();
    await expect(page.getByTestId("breakpoints-pane")).toContainText("Line 11");

    await page.getByTestId("debug-start").click();
    await expect(page.getByTestId("studio-status")).toContainText("Paused at a breakpoint");

    // Autos: the transaction is open, so ttsLevel is 1 (VB-023).
    await page.getByTestId("bottom-tab-autos").click();
    const autos = page.getByTestId("autos-pane");
    await expect(autos).toContainText("HVND");
    await expect(autos.locator("tr", { hasText: "Transaction level" })).toContainText("1");
    // We do not model these, and say so rather than inventing a value.
    await expect(autos).toContainText("not simulated");

    // Locals: the buffer expands to its fields.
    await page.getByTestId("bottom-tab-locals").click();
    await page.getByTestId("local-inventTable").click();
    await expect(page.getByTestId("local-field-inventTable-ItemId")).toContainText("F-100");

    await page.getByTestId("debug-stop").click();
    await expect(page.getByTestId("studio-status")).toContainText("Debugging stopped");
  });

  test("steps a line at a time, and the counter moves in Locals", async ({ page }) => {
    await openStudio(page);

    await setBreakpoint(page, "counter++;");
    await page.getByTestId("debug-start").click();
    await expect(page.getByTestId("studio-status")).toContainText("Paused at a breakpoint");

    await page.getByTestId("bottom-tab-locals").click();
    await expect(page.getByTestId("local-counter")).toContainText("0");

    // F10 back to the loop header, then round again to the same line: counter is 1.
    await page.getByTestId("debug-step-over").click();
    await expect(page.getByTestId("studio-status")).toContainText("Paused on line");

    await page.getByTestId("debug-start").click();
    await expect(page.getByTestId("local-counter")).toContainText("1");

    await page.getByTestId("debug-stop").click();
  });

  test("runs straight through when no breakpoints are set", async ({ page }) => {
    // Start Debugging with an empty Breakpoints window does nothing visible, and a learner
    // needs to meet that rather than conclude the debugger is broken.
    await openStudio(page);

    await page.getByTestId("debug-start").click();

    await expect(page.getByTestId("studio-infolog")).toContainText("Blocked 4 items");
    await expect(page.getByTestId("studio-status")).toContainText("Ready —");
  });
});
