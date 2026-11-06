import ts from "typescript";

export function validateDeploymentConfig(source: string): string | undefined {
  const parsed = ts.parseConfigFileTextToJson("wrangler.jsonc", source);
  if (parsed.error) return "wrangler.jsonc must be valid JSONC.";
  const value: unknown = parsed.config;
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "wrangler.jsonc must contain an object.";

  const config = value as Record<string, unknown>;
  if (config.workers_dev !== false || config.preview_urls !== false)
    return "Set workers_dev and preview_urls to false to prevent alternate public URLs.";

  const rawRoutes = config.routes ?? (config.route === undefined ? [] : [config.route]);
  if (!Array.isArray(rawRoutes) || rawRoutes.length === 0)
    return "Add an actual custom-domain or zone route for the API hostname.";

  const everyRouteIsConfigured = rawRoutes.every((route) => {
    if (typeof route !== "object" || route === null || Array.isArray(route)) return false;
    const candidate = route as Record<string, unknown>;
    if (typeof candidate.pattern !== "string" || candidate.pattern.trim() === "") return false;
    const isZoneRoute =
      (typeof candidate.zone_id === "string" && candidate.zone_id.trim() !== "") ||
      (typeof candidate.zone_name === "string" && candidate.zone_name.trim() !== "");
    const isCustomDomain = candidate.custom_domain === true;
    if (!isZoneRoute && !isCustomDomain) return false;
    const routeValues = [candidate.pattern, candidate.zone_name, candidate.zone_id].filter(
      (item): item is string => typeof item === "string",
    );
    return !routeValues.some((item) => {
      if (/(?:your[-_ ]?domain|placeholder|<[^>]+>)/iu.test(item)) return true;
      const host = item
        .trim()
        .replace(/^https?:\/\//iu, "")
        .split(/[/?#]/u, 1)[0]!
        .replace(/:\d+$/u, "")
        .replace(/\.$/u, "")
        .replace(/^\*\./u, "")
        .toLowerCase();
      return (
        /(?:^|\.)example\.(?:com|net|org)$/u.test(host) ||
        /(?:^|\.)(?:test|invalid|localhost|example)$/u.test(host) ||
        host === "localhost"
      );
    });
  });
  if (!everyRouteIsConfigured)
    return "Every route must be a real zone/custom-domain route; sample domains and placeholders are rejected.";
  return undefined;
}
