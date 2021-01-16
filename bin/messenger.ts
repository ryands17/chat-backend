#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from '@aws-cdk/core'
import { MessengerStack } from '../lib/messenger-stack'

const app = new cdk.App()
new MessengerStack(app, 'MessengerStack', {
  env: { region: app.node.tryGetContext('region') },
})
