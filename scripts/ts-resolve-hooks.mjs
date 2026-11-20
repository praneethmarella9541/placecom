// Lets node's test runner load our TypeScript the way the app imports it: a relative import without
// an extension ("./template") finds "./template.ts". Only used by `npm test`; the app itself is
// built by Next, which already resolves these.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      return nextResolve(`${specifier}.ts`, context);
    }
    throw error;
  }
}
