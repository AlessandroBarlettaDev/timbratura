import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import * as path from 'path';

export class HostingConfig extends Construct {
  // URL pubblico dell'app — usato come APP_URL e RP_ORIGIN nei Lambda
  public readonly appUrl: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    // Bucket S3 privato — i file non sono pubblici, CloudFront li serve tramite OAC
    const bucket = new s3.Bucket(this, 'FrontendBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy:     cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,   // pulisce il bucket quando lo stack viene eliminato
    });

    // Distribuzione CloudFront — HTTPS automatico, CDN globale
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        // OAC (Origin Access Control): CloudFront accede a S3 senza renderlo pubblico
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy:          cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',

      // Angular usa il routing lato client — ogni URL sconosciuto ritorna index.html
      // CloudFront trasforma il 403/404 di S3 in una risposta 200 con index.html
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: cdk.Duration.seconds(0) },
      ],
    });

    // Carica i file del build Angular su S3 e invalida la cache CloudFront ad ogni deploy
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '../../../frontend/dist/frontend/browser')),
      ],
      destinationBucket: bucket,
      distribution,
      distributionPaths: ['/*'],   // invalida tutta la cache CloudFront dopo ogni upload
    });

    this.appUrl = `https://${distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, 'AppUrl', {
      value:       this.appUrl,
      description: 'URL pubblico del frontend (usa questo come APP_URL e RP_ORIGIN)',
    });
  }
}
