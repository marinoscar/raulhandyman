// =============================================================================
// site.ts — single source of truth for all business content.
// Edit this file to change the phone number, services, towns, or FAQ.
// Every page, the sitemap, and the structured data (JSON-LD) read from here.
// =============================================================================

export const business = {
  name: 'Raul Handyman',
  shortName: 'Raul',
  tagline: 'Construction & Home Repairs',
  url: 'https://raulhandyman.net',
  phoneDisplay: '973-906-9503',
  phoneE164: '+19739069503',
  yearsExperience: '20+',
  insured: true,
  baseCity: 'Conroe',
  region: 'TX',
  regionName: 'Texas',
  // Fill these in once they exist. null hides the related UI and schema.
  email: null as string | null,
  googleBusinessUrl: null as string | null, // e.g. https://g.page/r/XXXX
  googleReviewUrl: null as string | null, // the "write a review" link from Google Business Profile
};

// Towns listed on the site and in the structured data. `core: true` = highlighted.
export const towns = [
  { name: 'Conroe', core: true },
  { name: 'The Woodlands', core: true },
  { name: 'Montgomery', core: false },
  { name: 'Willis', core: false },
  { name: 'Spring', core: false },
  { name: 'Magnolia', core: false },
  { name: 'Shenandoah', core: false },
  { name: 'Oak Ridge North', core: false },
];

export type Service = {
  slug: string;
  tag: string;
  name: string;
  /** Used in <title>: "<seoName> in Conroe, TX | Raul Handyman". Keep short. */
  seoName: string;
  summary: string;
  intro: string;
  jobs: string[];
  details: { heading: string; body: string }[];
  faq: { q: string; a: string }[];
};

export const services: Service[] = [
  {
    slug: 'drywall-repair',
    tag: 'Walls',
    name: 'Drywall repair',
    seoName: 'Drywall Repair',
    summary: 'Holes, cracks, water damage patches, and texture matching so the repair disappears.',
    intro:
      'A hole from a doorknob, a crack over a doorway, or a stain from an old leak makes a whole room look worn. Raul patches drywall so the repair blends into the wall once it is painted.',
    jobs: [
      'Doorknob and furniture holes',
      'Nail pops and settling cracks',
      'Patches after plumbing or electrical work',
      'Water-damaged sections cut out and replaced',
      'Texture matching (orange peel, knockdown, smooth)',
      'Corner bead and tape seam repairs',
    ],
    details: [
      {
        heading: 'Matching the texture is the hard part',
        body: 'Most homes around Conroe and The Woodlands have orange peel or knockdown texture on the walls. A flat patch on a textured wall stands out, so the texture is matched before the area is primed and painted.',
      },
      {
        heading: 'Water damage: fix the leak first',
        body: 'If the stain came from a leak, the source needs to be fixed and the wall needs to be dry before it is patched. Otherwise the stain comes back. Raul will tell you if what he sees needs a plumber or roofer first.',
      },
    ],
    faq: [
      { q: 'Can you paint the patch too?', a: 'Yes. Small patches can be spot-painted if you have the original paint. Otherwise the whole wall is usually repainted so the color matches.' },
      { q: 'How long does a drywall repair take?', a: 'Small patches often need two short visits so the compound can dry between coats. Raul will tell you the timing when he sees the job.' },
    ],
  },
  {
    slug: 'painting',
    tag: 'Paint',
    name: 'Interior & exterior painting',
    seoName: 'Interior & Exterior Painting',
    summary: 'Rooms, trim, doors, cabinets, siding touch-ups and fences.',
    intro:
      'Fresh paint is the fastest way to make a room or the outside of a house look cared for. Raul handles single rooms, trim, doors and exterior touch-ups, with the prep work that makes paint last.',
    jobs: [
      'Single rooms and accent walls',
      'Baseboards, trim and crown molding',
      'Interior and front doors',
      'Kitchen and bathroom cabinets',
      'Exterior trim and siding touch-ups',
      'Fences and gates',
    ],
    details: [
      {
        heading: 'Prep is most of the job',
        body: 'Filling nail holes, caulking gaps, sanding glossy surfaces, and protecting floors and furniture take more time than rolling the paint. Skipping prep is why paint jobs peel and crack early.',
      },
      {
        heading: 'Paint that holds up in Texas weather',
        body: 'Heat, humidity and strong sun are hard on exterior paint. Exterior work is planned around the weather and uses paint made for outdoor surfaces.',
      },
    ],
    faq: [
      { q: 'Do I need to buy the paint?', a: 'Either way works. You can pick the color and brand, or Raul can pick up the paint and include it in the price.' },
      { q: 'Do you move furniture?', a: 'Light furniture is moved and covered as part of the job. Let Raul know ahead of time about anything heavy or fragile.' },
    ],
  },
  {
    slug: 'doors-and-trim',
    tag: 'Carpentry',
    name: 'Doors, trim & baseboards',
    seoName: 'Door, Trim & Baseboard Repair',
    summary: 'Sticking doors, new hardware, door replacement, trim and baseboard install.',
    intro:
      'Doors that stick, rub, or will not latch are common in this area as houses settle and humidity changes. Raul adjusts, repairs and replaces doors, and installs trim and baseboards that finish a room.',
    jobs: [
      'Sticking, rubbing or sagging doors',
      'Doors that will not latch or lock',
      'New knobs, handles, deadbolts and hinges',
      'Interior door replacement (prehung or slab)',
      'Baseboards, casing and shoe molding',
      'Damaged trim cut out and replaced',
    ],
    details: [
      {
        heading: 'Adjust before you replace',
        body: 'Many sticking doors only need the hinges tightened, a longer screw into the framing, or a strike plate moved. Raul will try the simple fix first and tell you if the door really needs replacing.',
      },
      {
        heading: 'Finished, not just installed',
        body: 'New trim is filled, caulked and painted so it looks like it was always there.',
      },
    ],
    faq: [
      { q: 'Can you install a door I already bought?', a: 'Yes. Send a photo of the door and the opening by text, and Raul will check that it fits before the visit.' },
      { q: 'Do you change locks?', a: 'Raul can install new knobs, handles and deadbolts. For rekeying or security systems, he will point you to a locksmith.' },
    ],
  },
  {
    slug: 'fence-and-deck-repair',
    tag: 'Outdoor',
    name: 'Fence & deck repair',
    seoName: 'Fence & Deck Repair',
    summary: 'Replace pickets and posts, fix gates, repair and refresh decks.',
    intro:
      'Wood fences and decks take a beating from sun, rain and storms. Raul replaces broken pickets and rotted posts, fixes gates that drag, and repairs decks so they are safe to use.',
    jobs: [
      'Leaning or broken fence posts',
      'Loose, missing or rotted pickets',
      'Sagging gates and broken latches',
      'Storm damage repairs',
      'Rotted deck boards and stair treads',
      'Loose deck railings',
    ],
    details: [
      {
        heading: 'Posts are usually the problem',
        body: 'A leaning fence section usually means a post has rotted at the ground line. Replacing the post and resetting it in concrete fixes the lean.',
      },
      {
        heading: 'Deck safety first',
        body: 'Soft boards, wobbly railings and loose stairs are checked first, because those are the parts people get hurt on.',
      },
    ],
    faq: [
      { q: 'Do you build new fences?', a: 'Raul focuses on repairs and short sections. For a full new fence line, call to talk through the job.' },
      { q: 'Can you stain the fence after repairs?', a: 'Yes. Repaired sections can be stained so new wood blends in with the old.' },
    ],
  },
  {
    slug: 'flooring-repair',
    tag: 'Floors',
    name: 'Flooring repairs',
    seoName: 'Flooring Repair',
    summary: 'Loose or cracked tile, vinyl plank replacement, and transitions.',
    intro:
      'One cracked tile or a lifted plank can make a whole floor look worn. Raul replaces damaged pieces and fixes transitions between rooms without redoing the whole floor.',
    jobs: [
      'Cracked or loose tile replacement',
      'Grout repair',
      'Vinyl plank (LVP) board replacement',
      'Transition strips and thresholds',
      'Small areas of new flooring',
      'Squeaky subfloor spots',
    ],
    details: [
      {
        heading: 'Keep your spare pieces',
        body: 'Leftover tile or planks from the original install are the best way to get an exact match. If there are none, Raul can help you find the closest match.',
      },
    ],
    faq: [
      { q: 'Do you install whole floors?', a: 'Raul focuses on repairs and small areas. Call to talk about larger jobs.' },
    ],
  },
  {
    slug: 'tv-mounting-and-shelving',
    tag: 'Installs',
    name: 'TV mounting & shelving',
    seoName: 'TV Mounting & Shelving',
    summary: 'Wall mounts, floating shelves, curtain rods, mirrors and art hung level.',
    intro:
      'Heavy items need to go into the studs or the right anchors, at the right height, and level. Raul mounts TVs, shelves, mirrors and curtain rods so they stay put.',
    jobs: [
      'TV wall mounts',
      'Floating and bracket shelves',
      'Curtain rods and blinds',
      'Mirrors and large art',
      'Closet shelving and organizers',
      'Garage storage racks',
    ],
    details: [
      {
        heading: 'Into the studs',
        body: 'TVs and heavy shelves are anchored into wall studs. Where there is no stud, the right anchor for the weight is used.',
      },
    ],
    faq: [
      { q: 'Can you hide the TV wires?', a: 'Cord covers can be installed on the wall. Running power inside the wall needs a licensed electrician.' },
    ],
  },
  {
    slug: 'caulking-and-weatherproofing',
    tag: 'Weather',
    name: 'Caulking & weatherproofing',
    seoName: 'Caulking & Weatherproofing',
    summary: 'Windows, doors, tubs and showers resealed to keep water and drafts out.',
    intro:
      'Cracked caulk lets water behind tubs and showers and lets hot, humid air in around windows and doors. Raul removes old caulk and reseals so it is clean and watertight.',
    jobs: [
      'Tub and shower recaulking',
      'Kitchen and bathroom sinks and backsplashes',
      'Window and exterior door gaps',
      'Door sweeps and weatherstripping',
      'Exterior trim and siding gaps',
    ],
    details: [
      {
        heading: 'Old caulk comes out first',
        body: 'New caulk over old, moldy caulk does not seal and does not last. The old caulk is removed and the joint is cleaned and dried before resealing.',
      },
    ],
    faq: [
      { q: 'How soon can I use the shower?', a: 'Most bathroom caulk needs about a day to cure. Raul will tell you the exact time for the product used.' },
    ],
  },
  {
    slug: 'assembly-and-small-repairs',
    tag: 'Odd jobs',
    name: 'Assembly & small repairs',
    seoName: 'Furniture Assembly & Small Repairs',
    summary: 'Furniture, playsets, storage, and the to-do list you keep putting off.',
    intro:
      'Most homes have a list of small jobs that never get done. Save them up and Raul can work through the list in one visit.',
    jobs: [
      'Furniture and bed frame assembly',
      'Outdoor playsets and storage sheds (kits)',
      'Cabinet door and drawer adjustments',
      'Loose railings and handrails',
      'Replacing outlet covers and switch plates',
      'Whatever else is on your list',
    ],
    details: [
      {
        heading: 'Send the list ahead of time',
        body: 'Text the list, with photos if you can. That makes it possible to bring the right tools and parts and get more done in one trip.',
      },
    ],
    faq: [
      { q: 'Is there a minimum job size?', a: 'Call or text to ask. Combining several small jobs into one visit is usually the best value.' },
    ],
  },
];

export const homeFaq = [
  { q: 'How do I get a price?', a: `Call or text ${business.phoneDisplay}. A photo of the job by text is the fastest way to get a ballpark. For bigger jobs, Raul comes out to see it in person before giving a firm price.` },
  { q: 'Do you take small jobs?', a: 'Yes. Many customers save up a short list of small repairs and get them done in one visit.' },
  { q: 'Are you insured?', a: 'Yes. Raul is insured, and proof of insurance is available on request.' },
  { q: 'Which areas do you serve?', a: 'Conroe, The Woodlands, and nearby towns including Montgomery, Willis, Spring and Magnolia. If you are nearby and not sure, ask.' },
  { q: 'Do you do electrical or plumbing work?', a: 'Jobs that require a licensed electrician or plumber are referred out. Raul can tell you which kind of pro your job needs.' },
];
