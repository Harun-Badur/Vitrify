import {
  PAN_AXIS_SLOP_PX,
  PAN_MAX_ANGLE_FROM_VERTICAL_DEG,
  resolvePanAxis,
} from '../lib/motion';

const at = (deg: number, dist: number) => ({
  dx: Math.sin((deg * Math.PI) / 180) * dist,
  dy: -Math.cos((deg * Math.PI) / 180) * dist,
});

describe('resolvePanAxis', () => {
  it('slop altında karar vermez', () => {
    expect(resolvePanAxis(1, -(PAN_AXIS_SLOP_PX - 2))).toBe('undecided');
  });

  it.each([0, 10, 20, 30, 40, 45])('dikeyden %i° sapma dikey sayılır', (deg) => {
    const { dx, dy } = at(deg, 40);
    expect(resolvePanAxis(dx, dy)).toBe('vertical');
    expect(resolvePanAxis(-dx, -dy)).toBe('vertical');
  });

  it('seyrek (flick) ilk olayında büyük sıçrama da dikey sayılır', () => {
    const { dx, dy } = at(40, 120);
    expect(resolvePanAxis(dx, dy)).toBe('vertical');
  });

  it.each([65, 75, 90])('dikeyden %i° sapma yataydır (galeri)', (deg) => {
    const { dx, dy } = at(deg, 40);
    expect(resolvePanAxis(dx, dy)).toBe('horizontal');
  });

  it('sınır açısı 50°', () => {
    expect(PAN_MAX_ANGLE_FROM_VERTICAL_DEG).toBe(50);
  });
});
