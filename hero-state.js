export class HeroFlightState {
  constructor() {
    this.state = 'grounded';
    this._timer = 0;
    this._duration = 1;
  }

  get progress() {
    if (this.state === 'takingOff' || this.state === 'landing') {
      return Math.min(1, Math.max(0, this._timer / this._duration));
    }
    return 0;
  }

  get busy() {
    return this.state === 'takingOff' || this.state === 'landing';
  }

  requestTakeoff(duration) {
    if (this.state !== 'grounded') return false;
    this.state = 'takingOff';
    this._timer = 0;
    this._duration = Math.max(0.01, duration);
    return true;
  }

  requestLanding() {
    if (this.state !== 'flying') return false;
    this.state = 'landingApproach';
    return true;
  }

  cancelLanding() {
    if (this.state !== 'landingApproach') return false;
    this.state = 'flying';
    return true;
  }

  touchdown(duration) {
    if (this.state !== 'flying' && this.state !== 'landingApproach') return false;
    this.state = 'landing';
    this._timer = 0;
    this._duration = Math.max(0.01, duration);
    return true;
  }

  forceGrounded() {
    this.state = 'grounded';
    this._timer = 0;
  }

  update(dt) {
    if (this.state === 'takingOff') {
      this._timer += dt;
      if (this._timer >= this._duration) {
        this.state = 'flying';
        return 'flyingStarted';
      }
    } else if (this.state === 'landing') {
      this._timer += dt;
      if (this._timer >= this._duration) {
        this.state = 'grounded';
        return 'grounded';
      }
    }
    return null;
  }
}
