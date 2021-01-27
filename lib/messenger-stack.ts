import * as cdk from '@aws-cdk/core'
import * as cg from '@aws-cdk/aws-cognito'
import * as appS from '@aws-cdk/aws-appsync'
import * as ddb from '@aws-cdk/aws-dynamodb'
import * as iam from '@aws-cdk/aws-iam'

export class MessengerStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    // User Pool for authentication
    const userPool = new cg.UserPool(this, 'messengerAuth', {
      selfSignUpEnabled: true,
      autoVerify: { email: true },
      passwordPolicy: {
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
    })

    const userPoolClient = new cg.UserPoolClient(this, 'messengerAuthClient', {
      userPool: userPool,
      userPoolClientName: 'web',
      authFlows: { userSrp: true, userPassword: true },
      preventUserExistenceErrors: true,
    })

    // Messenger GraphQL API
    const api = new appS.GraphqlApi(this, 'messenger', {
      name: 'messenger',
      logConfig: { fieldLogLevel: appS.FieldLogLevel.ERROR },
      schema: appS.Schema.fromAsset('schema.graphql'),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appS.AuthorizationType.USER_POOL,
          userPoolConfig: {
            userPool,
          },
        },
      },
    })

    // DynamoDB tables for storing messages
    const messageTable = new ddb.Table(this, 'messages', {
      tableName: 'message',
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'id', type: ddb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // GSI for getting all messages by room
    messageTable.addGlobalSecondaryIndex({
      indexName: 'messages-in-room',
      partitionKey: { name: 'roomId', type: ddb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: ddb.AttributeType.STRING },
    })

    const messageAccessGSI = new iam.Role(this, 'messageAccessGSI', {
      assumedBy: new iam.ServicePrincipal('dynamodb.amazonaws.com'),
    })

    messageAccessGSI.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        resources: [`${messageTable.tableArn}/index/*`],
        actions: ['dymamodb:*'],
      })
    )

    const roomTable = new ddb.Table(this, 'rooms', {
      tableName: 'room',
      billingMode: ddb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'id', type: ddb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    })

    // Add resolvers for fetching data
    const messageResolverDdb = api.addDynamoDbDataSource(
      'message',
      messageTable
    )
    const roomResolverDdb = api.addDynamoDbDataSource('room', roomTable)

    for (let { fieldName, typeName } of messageResolvers) {
      messageResolverDdb.createResolver({
        fieldName,
        typeName,
        ...getMappingTemplates({ typeName, fieldName }),
      })
    }

    for (let { fieldName, typeName } of roomResolvers) {
      roomResolverDdb.createResolver({
        fieldName,
        typeName,
        ...getMappingTemplates({ typeName, fieldName }),
      })
    }

    // all Cloudformation outputs
    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
    })

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
    })

    new cdk.CfnOutput(this, 'GraphQLAPIURL', {
      value: api.graphqlUrl,
    })
  }
}

const messageResolvers = [
  { typeName: 'Query', fieldName: 'listMessagesForRoom' },
  { typeName: 'Mutation', fieldName: 'createMessage' },
  { typeName: 'Mutation', fieldName: 'deleteMessage' },
  { typeName: 'Room', fieldName: 'messages' },
]

const roomResolvers = [
  { typeName: 'Query', fieldName: 'listRooms' },
  { typeName: 'Mutation', fieldName: 'createRoom' },
]

const getMappingTemplates = ({
  typeName,
  fieldName,
}: {
  typeName: string
  fieldName: string
}) => {
  return {
    requestMappingTemplate: appS.MappingTemplate.fromFile(
      `mappingTemplates/${typeName}.${fieldName}.request.vtl`
    ),
    responseMappingTemplate: appS.MappingTemplate.fromFile(
      `mappingTemplates/${typeName}.${fieldName}.response.vtl`
    ),
  } as const
}
