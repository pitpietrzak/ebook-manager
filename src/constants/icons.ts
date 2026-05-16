/**
 * A curated list of high-quality, relevant icons for the library.
 * This prevents overwhelming the user while providing excellent coverage 
 * for common genres and categories.
 */
const RAW_ICONS = [
  // Books & Reading
  'Book', 'BookOpen', 'BookCopy', 'BookMarked', 'Bookmark', 'Library', 'Scroll', 'ScrollText', 'Glasses', 'PenTool', 'Languages', 'NotebookPen', 'NotepadText', 'Newspaper',
  
  // Fantasy & Adventure
  'Wand', 'WandSparkles', 'Flame', 'Sword', 'Axe', 'Shield', 'Crown', 'Gem', 'Castle', 'Mountain', 'Trees', 'Ghost', 'Skull', 'Map', 'Compass', 'Anchor', 'Tent', 'Milestone',
  
  // Sci-Fi & Technology
  'Rocket', 'Orbit', 'Binary', 'Code', 'Terminal', 'Cpu', 'Database', 'Atom', 'Dna', 'FlaskConical', 'Zap', 'Globe', 'Wifi', 'Satellite', 'Telescope', 'Bot', 'BrainCircuit', 'Microchip',
  
  // Moods & Themes
  'Heart', 'Star', 'Moon', 'Sun', 'Cloud', 'CloudMoon', 'CloudSun', 'Rain', 'Snowflake', 'Wind', 'Droplets', 'Zap', 'Smile', 'Laugh', 'Annoyed', 'Frown', 'Ghost', 'Sparkles',
  
  // Lifestyle & Genres
  'Coffee', 'Music', 'Headphones', 'Camera', 'Palette', 'GraduationCap', 'Briefcase', 'ShoppingCart', 'Gift', 'Trophy', 'Target', 'Activity', 'Stethoscope', 'Dumbbell', 'ChefHat', 'Film', 'Gamepad2', 'Theater',
  
  // Objects & Transport
  'Key', 'Lock', 'Bell', 'Mail', 'Send', 'Phone', 'Truck', 'Plane', 'Car', 'Bike', 'Ship', 'Train', 'LifeBuoy', 'Umbrella', 'Lightbulb', 'Trash2', 'Package', 'PenSquare',
  
  // Nature
  'Leaf', 'Flower', 'PawPrint', 'Bird', 'Fish', 'Bug', 'TreePine', 'TreePalm', 'Sprout',

  // Places & Home
  'Home', 'Building2', 'School', 'Church', 'Landmark', 'Store',

  // Extra utility
  'Folder', 'FolderOpen', 'Archive', 'Tag', 'Tags', 'Layers', 'List', 'Grid3x3',
];

export const ALL_ICONS = Array.from(new Set(RAW_ICONS)).sort();

export const SAFE_ICONS = ALL_ICONS;
