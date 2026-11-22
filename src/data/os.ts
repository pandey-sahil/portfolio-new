// Everything the desktop shows. The name, role, company, city, LinkedIn and GitHub are real; the rest is
// lorem ipsum for Sahil to replace in his own words. Edit here, not in the components.

export const profile = {
  name: 'Sahil Pandey',
  role: 'Sr. Webflow Developer',
  company: 'Flowdojo',
  companyNote: 'Lorem ipsum dolor sit amet',
  city: 'Bhopal, India',
  timeZone: 'Asia/Kolkata',
  tagline: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.',
  // placeholder address: replace with yours
  email: 'email@example.com',
  github: 'https://github.com/pandey-sahil',
  linkedin: 'https://www.linkedin.com/in/pandey-sahil',
  // No resume file yet: the resume icon opens LinkedIn until a PDF is dropped in /public.
  resume: 'https://www.linkedin.com/in/pandey-sahil',
};

const LOREM = {
  short: 'Lorem ipsum dolor sit amet.',
  line: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
  para:
    'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris.',
};

export const about = [LOREM.para, LOREM.para, 'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.'];

export const education = {
  degree: 'Lorem ipsum',
  school: 'Dolor Sit Amet',
};

export interface Role {
  title: string;
  company: string;
  period: string;
  points: string[];
}

export const experience: Role[] = [
  { title: profile.role, company: profile.company, period: 'Lorem — now', points: [LOREM.line, LOREM.line, LOREM.short] },
  { title: 'Lorem ipsum', company: profile.company, period: 'Lorem — ipsum', points: [LOREM.line, LOREM.short] },
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

export const projects: Project[] = ['Lorem Ipsum', 'Dolor Sit', 'Amet Consectetur', 'Adipiscing Elit'].map((name, i) => ({
  name,
  file: `project-0${i + 1}`,
  year: 'Lorem',
  stack: 'Lorem · Ipsum · Dolor',
  summary: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.',
  code: profile.github,
}));

export const stack: { group: string; items: string[] }[] = [
  { group: 'lorem', items: ['Lorem', 'Ipsum', 'Dolor'] },
  { group: 'ipsum', items: ['Sit', 'Amet'] },
  { group: 'dolor', items: ['Consectetur', 'Adipiscing'] },
  { group: 'sit', items: ['Elit', 'Sed', 'Tempor'] },
];

// How a build runs, shown as the About stepper.
export interface Step {
  name: string;
  body: string;
  get: string;
}

export const process: Step[] = ['Lorem ipsum', 'Dolor sit', 'Amet', 'Consectetur'].map((name) => ({
  name,
  body: LOREM.line + ' Sed do eiusmod tempor incididunt.',
  get: LOREM.short,
}));

// A short checklist, shown in done.txt.
export const doneChecks = {
  title: 'Lorem ipsum dolor sit amet',
  checks: [LOREM.line, 'Sed do eiusmod tempor incididunt ut labore.', 'Ut enim ad minim veniam, quis nostrud.'],
  close: 'Duis aute irure dolor in reprehenderit in voluptate.',
};
