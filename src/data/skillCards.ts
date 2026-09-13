export interface SkillIcon {
  src: string;
  alt: string;
}

export interface SkillCard {
  title: string;
  description: string;
  icons?: SkillIcon[];
  chips?: string[];
}

export const skillCards: SkillCard[] = [
  {
    title: 'Front-End Development',
    description: 'Building engaging and user-friendly web interfaces using modern frameworks and technologies with expertise.',
    icons: [
      { src: '/images/logos-html5-plain.svg', alt: 'HTML5' },
      { src: '/images/logos-javascript-plain.svg', alt: 'JavaScript' },
      { src: '/images/logos-typescript-plain.svg', alt: 'TypeScript' },
      { src: '/images/frame38.svg', alt: 'Next.js' },
      { src: '/images/logos-redux-original.svg', alt: 'Redux' },
      { src: '/images/react-group.svg', alt: 'React' },
    ],
  },
  {
    title: 'Back-End Development',
    description: 'Developing robust server-side logic and APIs to power dynamic and scalable web applications.',
    icons: [
      { src: '/images/skills/nodejs-plain-wordmark.svg', alt: 'Node.js' },
      { src: '/images/skills/express-original-wordmark.svg', alt: 'Express' },
      { src: '/images/skills/django-plain-wordmark.svg', alt: 'Django' },
      { src: '/images/skills/rails-plain-wordmark.svg', alt: 'Rails' },
    ],
  },
  {
    title: 'Core Computer Science Concepts',
    description: 'Demonstrating a strong foundation in core computer science principles, including problem-solving, system design, and efficient computing techniques.',
    chips: ['Operating Systems', 'Computer Networks', 'Object-Oriented Programming', 'DSA', 'System Design'],
  },
  {
    title: 'Personal Development',
    description: 'Committed to continuous learning and personal growth to excel in both professional and collaborative environments.',
    chips: ['Time Management', 'Problem Solving', 'Communication', 'Leadership'],
  },
  {
    title: 'Styling & Design',
    description: 'Crafting visually appealing and responsive designs with advanced styling tools and frameworks.',
    icons: [
      { src: '/images/skills/css3-plain.svg', alt: 'CSS3' },
      { src: '/images/skills/tailwindcss-plain.svg', alt: 'Tailwind CSS' },
      { src: '/images/skills/bootstrap-original.svg', alt: 'Bootstrap' },
      { src: '/images/skills/sass-original.svg', alt: 'Sass' },
      { src: '/images/skills/materialui-original.svg', alt: 'Material UI' },
    ],
  },
  {
    title: 'Web Animations',
    description: 'Creating seamless animations and transitions to enhance user engagement and interactivity.',
    icons: [
      { src: '/images/skills/framer-motion.svg', alt: 'Framer Motion' },
      { src: '/images/skills/image5.png', alt: 'GSAP' },
      { src: '/images/skills/lottie.svg', alt: 'Lottie' },
    ],
  },
  {
    title: 'Cloud & Deployment',
    description: 'Experienced in deploying and managing applications using modern cloud platforms and tools.',
    icons: [
      { src: '/images/skills/docker-plain.svg', alt: 'Docker' },
      { src: '/images/skills/azure-original.svg', alt: 'Azure' },
      { src: '/images/skills/image7.png', alt: 'AWS' },
      { src: '/images/skills/image8.png', alt: 'Google Cloud' },
      { src: '/images/skills/vercel.svg', alt: 'Vercel' },
    ],
  },
  {
    title: 'Testing & Debugging',
    description: 'Ensuring code quality and reliability through rigorous testing and debugging processes.',
    icons: [
      { src: '/images/skills/postman.svg', alt: 'Postman' },
      { src: '/images/skills/jest-plain.svg', alt: 'Jest' },
      { src: '/images/skills/selenium-original.svg', alt: 'Selenium' },
    ],
  },
  {
    title: 'Programming Languages',
    description: 'Proficient in problem-solving and applying programming languages to implement efficient data structures and algorithms.',
    icons: [
      { src: '/images/skills/python-original.svg', alt: 'Python' },
      { src: '/images/skills/c-original.svg', alt: 'C' },
      { src: '/images/skills/cplusplus.svg', alt: 'C++' },
      { src: '/images/skills/go.svg', alt: 'Go' },
    ],
  },
  {
    title: 'Database Management',
    description: 'Designing and managing databases to ensure secure and efficient data storage and retrieval.',
    icons: [
      { src: '/images/skills/mysql-plain-wordmark.svg', alt: 'MySQL' },
      { src: '/images/skills/postgresql-plain.svg', alt: 'PostgreSQL' },
      { src: '/images/skills/mongodb-plain-wordmark.svg', alt: 'MongoDB' },
      { src: '/images/skills/firebase-plain.svg', alt: 'Firebase' },
    ],
  },
  {
    title: 'Mobile App Development',
    description: 'Creating cross-platform mobile apps with sleek designs and robust functionality.',
    icons: [{ src: '/images/skills/image6.png', alt: 'React Native' }],
  },
  {
    title: 'Version Control & Collaboration',
    description: 'Effectively managing code and collaborating on projects to ensure seamless teamwork.',
    icons: [
      { src: '/images/skills/github-group.svg', alt: 'GitHub' },
      { src: '/images/skills/git-plain.svg', alt: 'Git' },
    ],
  },
  {
    title: 'UI/UX Design',
    description: 'Designing user-centric interfaces that are intuitive, visually appealing, and easy to navigate.',
    icons: [{ src: '/images/skills/figma-original.svg', alt: 'Figma' }],
    chips: ['Prototyping', 'Wireframing'],
  },
];
