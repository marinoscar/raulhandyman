// Structured data (JSON-LD) builders. Validate with https://search.google.com/test/rich-results
import { business, services, towns, type Service } from './site';
import { projectPath, serviceOf, type Project } from './projects';

const businessId = `${business.url}/#business`;

const areaServed = towns.map((t) => ({
  '@type': 'City',
  name: t.name,
  containedInPlace: { '@type': 'State', name: business.regionName },
}));

export function businessSchema(photoUrl: string, latestProjects: Project[] = []) {
  const sameAs = [business.googleBusinessUrl].filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'HomeAndConstructionBusiness',
    '@id': businessId,
    name: business.name,
    description: `Handyman and home repair services in ${business.baseCity}, The Woodlands and nearby areas. ${business.yearsExperience} years experience. Insured.`,
    url: `${business.url}/`,
    telephone: business.phoneE164,
    ...(business.email ? { email: business.email } : {}),
    image: [photoUrl, `${business.url}/og.jpg`],
    logo: `${business.url}/apple-touch-icon.png`,
    address: {
      '@type': 'PostalAddress',
      addressLocality: business.baseCity,
      addressRegion: business.region,
      addressCountry: 'US',
    },
    areaServed,
    knowsAbout: services.map((s) => s.name),
    hasOfferCatalog: {
      '@type': 'OfferCatalog',
      name: 'Handyman services',
      itemListElement: services.map((s) => ({
        '@type': 'Offer',
        itemOffered: { '@type': 'Service', name: s.name, url: `${business.url}/${s.slug}/` },
      })),
    },
    ...(sameAs.length ? { sameAs } : {}),
    ...(latestProjects.length
      ? { subjectOf: latestProjects.slice(0, 10).map((p) => ({ '@id': `${business.url}${projectPath(p)}#work` })) }
      : {}),
  };
}

export function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${business.url}/#website`,
    url: `${business.url}/`,
    name: business.name,
    publisher: { '@id': businessId },
    inLanguage: 'en-US',
  };
}

export function serviceSchema(s: Service) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: s.name,
    serviceType: s.seoName,
    description: s.intro,
    url: `${business.url}/${s.slug}/`,
    provider: { '@id': businessId },
    areaServed,
  };
}

export function breadcrumbSchema(s: Service) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Home', item: `${business.url}/` },
      { '@type': 'ListItem', position: 2, name: s.name, item: `${business.url}/${s.slug}/` },
    ],
  };
}

const abs = (path: string) => `${business.url}${path}`;

/** `images` maps photo id to its final optimised URL and size (absolute URL). */
export function projectSchema(p: Project, images: Record<string, { url: string; width: number; height: number }>) {
  const svc = serviceOf(p);
  const imgs = p.photos
    .filter((ph) => images[ph.id])
    .map((ph) => ({
      '@type': 'ImageObject',
      contentUrl: images[ph.id].url,
      ...(ph.caption ? { caption: ph.caption } : {}),
      description: ph.altText,
      width: images[ph.id].width,
      height: images[ph.id].height,
      creator: { '@id': businessId },
      creditText: business.name,
      copyrightNotice: `© ${business.name}`,
    }));
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    '@id': `${abs(projectPath(p))}#work`,
    name: p.title,
    headline: p.seoTitle || p.title,
    description: p.metaDescription,
    url: abs(projectPath(p)),
    datePublished: p.publishedAt.toISOString(),
    dateModified: p.updatedAt.toISOString(),
    ...(p.completedOn ? { dateCreated: p.completedOn } : {}),
    ...(svc ? { about: { '@type': 'Service', name: svc.name, url: abs(`/${svc.slug}/`) } } : {}),
    locationCreated: {
      '@type': 'City',
      name: p.townName,
      containedInPlace: { '@type': 'State', name: business.regionName },
    },
    creator: { '@id': businessId },
    provider: { '@id': businessId },
    image: imgs,
  };
}

export function projectBreadcrumbSchema(p: Project) {
  return projectsBreadcrumbSchema({ name: p.title, url: abs(projectPath(p)) });
}

export function projectListSchema(projects: Project[], pageUrl: string, name: string, description: string) {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name,
      description,
      url: pageUrl,
      isPartOf: { '@id': `${business.url}/#website` },
      about: { '@id': businessId },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      itemListElement: projects.map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(projectPath(p)), name: p.title })),
    },
  ];
}

export function projectsBreadcrumbSchema(extra?: { name: string; url: string }) {
  const items = [
    { name: 'Home', item: `${business.url}/` },
    { name: 'Projects', item: abs('/projects/') },
    ...(extra ? [{ name: extra.name, item: extra.url }] : []),
  ];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, ...it })),
  };
}
