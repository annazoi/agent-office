// The five stations' panels, one per toolkit, for the 3D office (E at a station) and the 2D view.
import type { ComposioToolkit } from '../../../shared/protocol';
import { openCalendar } from './calendar';
import type { PanelDeps } from './common';
import { openGmail } from './gmail';
import { openLinear } from './linear';
import { openNotion } from './notion';
import { openSlack } from './slack';

export type { PanelDeps } from './common';

export function openIntegration(toolkit: ComposioToolkit, deps: PanelDeps) {
  switch (toolkit) {
    case 'linear':
      return openLinear(deps);
    case 'notion':
      return openNotion(deps);
    case 'slack':
      return openSlack(deps);
    case 'googlecalendar':
      return openCalendar(deps);
    case 'gmail':
      return openGmail(deps);
  }
}
