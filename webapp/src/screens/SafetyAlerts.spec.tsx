import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react';

const push = vi.hoisted(() => ({
  currentPushState: vi.fn(),
  enablePush: vi.fn(),
  disablePush: vi.fn(),
}));
vi.mock('../lib/push', () => push);

import { SafetyAlerts } from './SafetyAlerts';

beforeEach(() => {
  push.currentPushState.mockReset();
  push.enablePush.mockReset();
  push.disablePush.mockReset();
});
afterEach(cleanup);

describe('SafetyAlerts', () => {
  it('offers to enable alerts when off, and subscribes on click', async () => {
    push.currentPushState.mockResolvedValue('off');
    push.enablePush.mockResolvedValue('on');
    render(<SafetyAlerts />);
    const btn = await waitFor(() => screen.getByRole('button', { name: 'Enable alerts' }));
    fireEvent.click(btn);
    await waitFor(() => expect(push.enablePush).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Alerts are on/)).toBeTruthy());
  });

  it('offers to turn off when on, and unsubscribes on click', async () => {
    push.currentPushState.mockResolvedValue('on');
    push.disablePush.mockResolvedValue('off');
    render(<SafetyAlerts />);
    const btn = await waitFor(() => screen.getByRole('button', { name: 'Turn off alerts' }));
    fireEvent.click(btn);
    await waitFor(() => expect(push.disablePush).toHaveBeenCalled());
  });

  it('shows an honest message when the browser does not support push', async () => {
    push.currentPushState.mockResolvedValue('unsupported');
    render(<SafetyAlerts />);
    await waitFor(() => expect(screen.getByText(/doesn’t support push/)).toBeTruthy());
  });

  it('explains when notifications are blocked', async () => {
    push.currentPushState.mockResolvedValue('denied');
    render(<SafetyAlerts />);
    await waitFor(() => expect(screen.getByText(/blocked/)).toBeTruthy());
  });

  it('surfaces an error if enabling fails', async () => {
    push.currentPushState.mockResolvedValue('off');
    push.enablePush.mockRejectedValue(new Error('network down'));
    render(<SafetyAlerts />);
    fireEvent.click(await waitFor(() => screen.getByRole('button', { name: 'Enable alerts' })));
    await waitFor(() => expect(screen.getByText(/network down/)).toBeTruthy());
  });
});
