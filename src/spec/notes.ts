/**
 * Notes about Search Console behaviour that the Discovery document does not
 * state (ADR-0004). A person reviews every note before it ships. Keys are
 * method ids as they appear in the spec.
 */
export type Notes = Record<string, readonly string[]>

/** Added to every method whose path contains {siteUrl}. */
export const SITE_URL_NOTE =
  'URL-encode the property in the path. For example, sc-domain:example.com becomes sc-domain%3Aexample.com, and https://example.com/ becomes https%3A%2F%2Fexample.com%2F.'

export const NOTES: Notes = {
  'searchanalytics.query': [
    'Grouping or filtering by query leaves out anonymised queries, which are rare queries Google hides for privacy. So the rows add up to less than the real total. Get totals from a separate request with no query dimension.',
    'rowLimit defaults to 1,000 and can be at most 25,000. To get more rows, send the same request again with startRow increased by rowLimit, until a response has fewer rows than rowLimit.',
    'Google returns at most 50,000 rows per day per search type, so a large site cannot get every query and page row.',
    'By default (dataState FINAL) the response has only settled data, which usually ends 2 to 3 days before today. Set dataState to ALL to include newer data that may still change.',
    'startDate and endDate are dates in Pacific Time, in YYYY-MM-DD format.',
    'With aggregationType AUTO, Google totals by property, unless you group or filter by page, in which case it totals by page. Totals by page are higher, because one search result can show several pages from the same site.',
    'Requests that group or filter by both page and query cost the most against Google\'s load quota, and so do long date ranges.'
  ],
  'urlInspection.index.inspect': [
    'Google allows 2,000 inspections per property per day and 600 per minute.',
    'inspectionUrl must belong to the property named in siteUrl.',
    'The result describes the version of the page in Google\'s index. It is not a live test of the page.'
  ],
  'sites.list': [
    'One website often has two properties, a Domain property (its siteUrl starts with sc-domain:) and a URL-prefix property (for example https://example.com/). They report different numbers, so say which one you used.',
    'A permissionLevel of siteUnverifiedUser means the user cannot read that property\'s data.'
  ],
  'sitemaps.submit': [
    'feedpath is the full URL of the sitemap, URL-encoded in the path.'
  ]
}
