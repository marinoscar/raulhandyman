// Structured data (JSON-LD) builders. Validate with https://search.google.com/test/rich-results
import { business, services, towns, type Service } from './site';

const businessId = `${business.url}/#business`;

const areaServed = towns.map((t) => ({
  '@type': 'City',
  name: t.name,
  containedInPlace: { '@type': 'State', name: business.regionName },
}));

export function businessSchema(photoUrl: string) {
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
