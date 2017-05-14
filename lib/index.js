'use strict';

const Boom = require('boom');
const Redis = require('ioredis');
const Ms = require('ms');
const Hoek = require('hoek');
const Limiter = require('ratelimiter');
const RequestIp = require('request-ip');
const ipRangeCheck = require("ip-range-check");

const internals = {
    defaults: {
        namespace: 'clhr',
        global: { limit: -1, duration: 1000 },
        redis: null,
        whiteListIpRange: ["64.18.0.0/20","64.233.160.0/19","66.102.0.0/20","66.249.80.0/20","72.14.192.0/18",
"74.125.0.0/16","108.177.8.0/21","172.217.0.0/19","173.194.0.0/16","207.126.144.0/20",
"209.85.128.0/17","216.58.192.0/19","216.239.32.0/19"]

    }
};


exports.register = (server, options, next) => {

    const settings = Hoek.applyToDefaults(internals.defaults, options);
    const redis = new Redis(options.redis);

    server.ext('onPreAuth', (request, reply) => {

        const route = request.route;

        /* $lab:coverage:off$ */
        let routeLimit = route.settings.plugins && route.settings.plugins['hapi-ratelimit'];
        /* $lab:coverage:on$ */

        if (!routeLimit && settings.global.limit > 0) {
            routeLimit = settings.global;
        }

        if (routeLimit) {
            const ipts = [settings.namespace, RequestIp.getClientIp(request), route.path].join(':');
            
            if (ipRangeCheck,settings.whiteListIpRange) {
                return reply.continue();
            }
            
            const routeLimiter = new Limiter({
                id: ipts,
                db: redis,
                max: routeLimit.limit,
                duration: Ms(routeLimit.duration)
            });

            routeLimiter.get((err, rateLimit) => {

                /* $lab:coverage:off$ */
                if (err) {
                    return reply(err);
                }
                /* $lab:coverage:on$ */

                request.plugins['hapi-ratelimit'] = {
                    limit: rateLimit.total,
                    remaining: rateLimit.remaining - 1,
                    reset: rateLimit.reset
                };

                if (rateLimit.remaining <= 0) {
                    const error = Boom.tooManyRequests('Rate limit exceeded');
                    error.output.headers['X-RateLimit-Limit'] = request.plugins['hapi-ratelimit'].limit;
                    error.output.headers['X-RateLimit-Remaining'] = request.plugins['hapi-ratelimit'].remaining;
                    error.output.headers['X-RateLimit-Reset'] = request.plugins['hapi-ratelimit'].reset;
                    error.reformat();
                    return reply(error);
                }

                return reply.continue();
            });
        }
        else {
            return reply.continue();
        }
    });

    server.ext('onPostHandler', (request, reply) => {

        if ('hapi-ratelimit' in request.plugins) {
            const response = request.response;

            if (!response.isBoom) {
                response.headers['X-RateLimit-Limit'] = request.plugins['hapi-ratelimit'].limit;
                response.headers['X-RateLimit-Remaining'] = request.plugins['hapi-ratelimit'].remaining;
                response.headers['X-RateLimit-Reset'] = request.plugins['hapi-ratelimit'].reset;
            }
        }

        reply.continue();
    });

    next();
};


exports.register.attributes = {
    pkg: require('../package.json')
};
