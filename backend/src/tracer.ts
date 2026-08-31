import tracer from 'dd-trace';

tracer.init({
  service: 'email-manager-monitoring',
});

export default tracer;
