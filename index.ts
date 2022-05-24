import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";

const project = pulumi.getProject();
const stack = pulumi.getStack();

let config = new pulumi.Config();

// Setup

const domain = "throttleheadweb.dev";

let subDomain = '';
let fullDomain = "throttlehead.dev"
let primaryZoneId = null;

if (stack !== 'prod') {
    primaryZoneId = config.requireSecret("primaryZoneId");

    subDomain = stack;
    fullDomain = stack+".throttlehead.dev"
}

const route53WebHostedZoneName = fullDomain;

let sslCertArn = config.require("sslCertArn");

// Get the cnames
// For context why interfaces are needed: https://www.leebriggs.co.uk/blog/2021/05/09/pulumi-apply

interface Cnames extends Array<string> { }

let cnames = config.requireObject<Cnames>("cnames");

console.log("Web domain: "+fullDomain);
console.log("Web full domain: "+fullDomain);
console.log("Web route 53 hosted zone name: "+route53WebHostedZoneName);
console.log(`Cnames: ${cnames}`);

let stackTags = {
    [project+"-stack"]: stack
};

// Create bucket and acl

const bucketName = "throttle-head-web-"+stack;

const s3BucketWeb = new aws.s3.Bucket(bucketName, {
    bucket: bucketName,
    tags: stackTags,
    acl: "public-read",
    website: {
        indexDocument: "index.html",
        errorDocument: "404.html"
    }
});

// Upload hello-world.html

const s3BucketWebSrc = new aws.s3.BucketObject("index.html", {
    acl: "public-read",
    contentType: "text/html",
    bucket: s3BucketWeb,
    source: new pulumi.asset.FileAsset("assets/hello-world.html")
});

// Create cloudfront distro

const s3Distribution = new aws.cloudfront.Distribution("throttle-head-web-acl-"+stack, {
    origins: [{
        domainName: s3BucketWeb.bucketRegionalDomainName,
        originId: s3BucketWeb.id,
    }],
    enabled: true,
    isIpv6Enabled: true,
    comment: "Cloudfront distro for throttledhead web",
    defaultRootObject: "index.html",
    aliases: cnames,
    defaultCacheBehavior: {
        allowedMethods: [
            "GET",
            "HEAD",
            "OPTIONS"
        ],
        cachedMethods: [
            "GET",
            "HEAD",
        ],
        targetOriginId: s3BucketWeb.id,
        forwardedValues: {
            queryString: false,
            cookies: {
                forward: "none",
            },
        },
        viewerProtocolPolicy: "redirect-to-https",
        minTtl: 0,
        defaultTtl: 86400,
        maxTtl: 432000,
        compress: true
    },
    priceClass: "PriceClass_100",
    tags: stackTags,
    restrictions: {
        geoRestriction: {
            restrictionType: "none"
        },
    },
    viewerCertificate: {
        acmCertificateArn: sslCertArn,
        sslSupportMethod: "sni-only"
    },
    customErrorResponses: [
        {
            errorCode: 404,
            errorCachingMinTtl: 300,
            responseCode: 404,
            responsePagePath: "/404.html"
        }, {
            errorCode: 403,
            errorCachingMinTtl: 300,
            responseCode: 404,
            responsePagePath: "/404.html"
        }
    ]
});

// Create hosted zone

const route53WebHostedZone = new aws.route53.Zone(route53WebHostedZoneName, {
    comment: "Hosted zone for throttleheadweb.dev",
    name: route53WebHostedZoneName
});

// Create record

const route53WebRecord = new aws.route53.Record("base", {
    zoneId: route53WebHostedZone.zoneId,
    name: "",
    type: "A",
    aliases: [{
        name: s3Distribution.domainName,
        zoneId: s3Distribution.hostedZoneId,
        evaluateTargetHealth: true
    }]
});

const route53WebWwwRecord = new aws.route53.Record("www", {
    zoneId: route53WebHostedZone.zoneId,
    name: 'www',
    type: "A",
    aliases: [{
        name: s3Distribution.domainName,
        zoneId: s3Distribution.hostedZoneId,
        evaluateTargetHealth: true
    }]
});

if (primaryZoneId !== null) {
    const route53PrimaryZoneRecord = new aws.route53.Record(route53WebHostedZoneName, {
        zoneId: primaryZoneId,
        name: route53WebHostedZoneName,
        type: "NS",
        records: route53WebHostedZone.nameServers,
        ttl: 300
    });
}

export const s3BucketWebId = s3BucketWeb.id;
export const route53WebHostedZoneId = route53WebHostedZone.id;
export const s3DistributionId = s3Distribution.id;
export const route53WebRecordName = route53WebRecord.name;
export const route53WebWwwRecordName = route53WebWwwRecord.name;
