/** The apps are not out yet: old download links go to the CLI page, which lists everything that's coming. */
export async function GET(req: Request) {
  return Response.redirect(new URL("/cli", req.url), 307);
}
