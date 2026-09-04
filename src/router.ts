export const APP_ROUTES = ["/network", "/departures", "/friends", "/recap", "/profile", "/settings"] as const;
export type AppRoute = typeof APP_ROUTES[number];

export function appRoute(pathname: string): AppRoute | "/" | "/login" | "/signup" | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (clean === "/" || clean === "/login" || clean === "/signup") return clean;
  return APP_ROUTES.includes(clean as AppRoute) ? clean as AppRoute : null;
}

export function routeNeedsAccount(route: string): boolean {
  return route === "/friends" || route === "/profile" || route === "/settings";
}
