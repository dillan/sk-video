import type { ComponentType, ReactNode, SVGProps } from 'react';
import type { Route } from '../lib/router';
import { LiveIcon, ReviewIcon, CamerasIcon, SafetyIcon } from './icons';

interface NavItem {
  route: Route;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'live', label: 'Live', Icon: LiveIcon },
  { route: 'review', label: 'Review', Icon: ReviewIcon },
  { route: 'cameras', label: 'Cameras', Icon: CamerasIcon },
  { route: 'safety', label: 'Safety', Icon: SafetyIcon },
];

interface NavProps {
  current: Route;
  onNavigate: (r: Route) => void;
}

function NavButtons({ current, onNavigate }: NavProps) {
  return (
    <>
      {NAV_ITEMS.map(({ route, label, Icon }) => (
        <button
          key={route}
          type="button"
          className="navitem"
          aria-current={current === route ? 'page' : undefined}
          onClick={() => onNavigate(route)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </>
  );
}

/** Side rail — shown on tablet/desktop (CSS hides it on phones). */
export function NavRail(props: NavProps & { authChip?: ReactNode }) {
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail__logo" aria-hidden="true">
        SK
      </div>
      <div className="rail__items">
        <NavButtons {...props} />
      </div>
      <div className="page-head__spacer" />
      {props.authChip}
    </nav>
  );
}

/** Bottom tab bar — shown on phones (CSS hides it on wider screens). */
export function TabBar(props: NavProps) {
  return (
    <nav className="tabbar" aria-label="Primary">
      <NavButtons {...props} />
    </nav>
  );
}
