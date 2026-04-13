import React from 'react';
import * as LucideIcons from 'lucide-react-native';
import { LucideProps } from 'lucide-react-native';

interface DynamicIconProps extends LucideProps {
  name: string;
}

/**
 * A component that renders a Lucide icon based on a string name.
 * Uses a mapping of common icons to ensure performance and correctness.
 */
export const DynamicIcon = ({ name, ...props }: DynamicIconProps) => {
  // Normalize name (e.g., 'book-open' -> 'BookOpen')
  const normalizedName = name
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') as keyof typeof LucideIcons;

  const IconComponent = LucideIcons[normalizedName] || LucideIcons.Layers;

  // @ts-ignore - Dynamic component rendering
  return <IconComponent {...props} />;
};

export default DynamicIcon;
