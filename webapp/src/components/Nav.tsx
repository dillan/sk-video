import type { ComponentType, ReactNode, SVGProps } from 'react';
import type { Cluster } from '../lib/router';
import { LiveIcon, ReviewIcon, CamerasIcon, SafetyIcon } from './icons';

interface NavItem {
  cluster: Cluster;
  label: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV_ITEMS: NavItem[] = [
  { cluster: 'live', label: 'Live', Icon: LiveIcon },
  { cluster: 'review', label: 'Review', Icon: ReviewIcon },
  { cluster: 'cameras', label: 'Cameras', Icon: CamerasIcon },
  { cluster: 'safety', label: 'Safety', Icon: SafetyIcon },
];

interface NavProps {
  current: Cluster;
  onNavigate: (c: Cluster) => void;
}

function NavButtons({ current, onNavigate }: NavProps) {
  return (
    <>
      {NAV_ITEMS.map(({ cluster, label, Icon }) => (
        <button
          key={cluster}
          type="button"
          className="navitem"
          aria-current={current === cluster ? 'page' : undefined}
          onClick={() => onNavigate(cluster)}
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
