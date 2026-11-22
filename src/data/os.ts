// Everything the desktop shows. Facts come from Sahil's LinkedIn profile and GitHub;
// edit here, not in the components.

export const profile = {
  name: 'Sahil Pandey',
  role: 'Sr. Webflow Developer',
  company: 'Flowdojo',
  companyNote: 'Webflow Premium Partner agency',
  city: 'Bhopal, India',
  timeZone: 'Asia/Kolkata',
  tagline:
    'I turn Figma files into fast, motion-rich Webflow sites, with GSAP, WebGL and clean structure underneath.',
  email: 'sahilp2593@gmail.com',
  github: 'https://github.com/pandey-sahil',
  linkedin: 'https://www.linkedin.com/in/pandey-sahil',
  // No resume file yet: the resume icon opens LinkedIn until a PDF is dropped in /public.
  resume: 'https://www.linkedin.com/in/pandey-sahil',
};

export const about = [
  "I'm a Webflow and front-end developer at Flowdojo, a Webflow Premium Partner agency in Bhopal.",
  'Most days I take a Figma design and turn it into a Webflow build that stays fast, accessible and easy for the client to edit: custom animation with GSAP and Lottie, the odd WebGL scene, and SEO structure that holds up after launch.',
  'I care about the part after the handover. A site is done when the form lands in the CRM, the tracking fires, and the team can change a headline without opening a ticket.',
];

export const education = {
  degree: 'B.Tech, Computer Science',
  school: 'Rajiv Gandhi Proudyogiki Vishwavidyalaya',
};

export interface Role {
  title: string;
  company: string;
  period: string;
  points: string[];
}

export const experience: Role[] = [
  {
    title: 'Sr. Webflow Developer',
    company: 'Flowdojo',
    period: 'Sep 2025 — now',
    points: [
      'Lead custom Webflow builds with motion-rich interaction in GSAP and Lottie.',
      'Turn designers’ Figma prototypes into responsive, high-performance builds.',
      'Tighten accessibility, load speed and SEO structure across client sites.',
    ],
  },
  {
    title: 'Frontend Developer',
    company: 'Flowdojo',
    period: 'Feb 2025 — Sep 2025',
    points: [
      'Built interactive landing pages and CMS-driven Webflow sites.',
      'Shipped GSAP animation and motion effects with the UI/UX team.',
      'Kept builds lean with clean JavaScript and structured CSS.',
    ],
  },
  {
    title: 'Frontend Developer Intern',
    company: 'Flowdojo',
    period: 'Dec 2024 — Jan 2025',
    points: [
      'Learned Webflow end to end on practice builds.',
      'Set up Client-First structures for scalable, maintainable sites.',
    ],
  },
];

export interface Project {
  name: string;
  file: string;
  year: string;
  stack: string;
  summary: string;
  image?: string;
  live?: string;
  code: string;
}

export const projects: Project[] = [
  {
    name: 'WebGL × Webflow',
    file: 'webgl-webflow',
    year: '2025',
    stack: 'WebGL · GLSL · Webflow',
    summary: 'A distortion shader for live type, with chromatic split and falloff you can tune from a control panel, built to drop into a Webflow page.',
    image: '/images/work/webgl.jpg',
    live: 'https://web-gl-webflow.vercel.app',
    code: 'https://github.com/pandey-sahil/WebGLWebflow',
  },
  {
    name: 'Three.js emblem',
    file: 'threejs-galaxy',
    year: '2025',
    stack: 'Three.js · WebGL',
    summary: 'A lit, extruded 3D emblem rendered in Three.js, an experiment in materials and lighting for brand marks.',
    image: '/images/work/galaxy.jpg',
    live: 'https://three-js-galaxy-bay.vercel.app',
    code: 'https://github.com/pandey-sahil/ThreeJs-Galaxy',
  },
  {
    name: 'Next.js styleguide',
    file: 'nextjs-styleguide',
    year: '2026',
    stack: 'Next.js · GSAP · Lenis',
    summary: 'A starter for agency and marketing sites: Lenis smooth scroll, scroll-triggered GSAP, and a working contact form.',
    code: 'https://github.com/pandey-sahil/NextJs-Styleguide',
  },
  {
    name: 'Task manager',
    file: 'task-manager',
    year: '2024',
    stack: 'React · Vite',
    summary: 'A small React task app: add, complete and clear, with state kept on the client.',
    image: '/images/work/tasks.jpg',
    live: 'https://task-manager-react-zeta.vercel.app',
    code: 'https://github.com/pandey-sahil/TaskManagerReact',
  },
];

export const stack: { group: string; items: string[] }[] = [
  { group: 'build', items: ['Webflow', 'HTML', 'CSS', 'JavaScript', 'Tailwind CSS', 'Node.js'] },
  { group: 'motion', items: ['GSAP', 'ScrollTrigger', 'Lottie', 'Swiper'] },
  { group: '3d', items: ['WebGL', 'Three.js', 'GLSL'] },
  { group: 'craft', items: ['Figma → Webflow', 'Client-First', 'SEO', 'Accessibility', 'Performance'] },
];

// How a build runs, from Sahil's LinkedIn roles and his "done" post. Shown as the About stepper.
export interface Step {
  name: string;
  body: string;
  get: string;
}

export const process: Step[] = [
  {
    name: 'Figma handoff',
    body: 'I go through the Figma file with the designer first: every breakpoint, every interaction, and what the CMS has to hold.',
    get: 'Questions answered before a single class is written.',
  },
  {
    name: 'Client-First build',
    body: 'The layout goes into Webflow on Client-First structure, responsive from the start, with names the next developer can read.',
    get: 'A Webflow project your team can open and edit.',
  },
  {
    name: 'Motion',
    body: 'GSAP and Lottie for the interactions the design calls for, written so the page stays fast and the animation never blocks the content.',
    get: 'Motion that feels designed, not bolted on.',
  },
  {
    name: 'Launch checks',
    body: 'I submit the form and watch it land in the CRM, check the event tags fire, and ask the team to change a headline without me.',
    get: 'A finished site, not a demo with a domain.',
  },
];

// Sahil's own checklist, from a LinkedIn post.
export const doneChecks = {
  title: 'Three checks before you call a site done',
  checks: [
    'Submit the form yourself. Watch it land in the CRM.',
    'Open the campaign page and check the event tags fire.',
    'Ask the team to change one headline without you.',
  ],
  close: 'If any of those fails, the site is not finished. It is a demo with a domain.',
};
