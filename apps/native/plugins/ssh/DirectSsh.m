#import <React/RCTBridgeModule.h>

extern char *csw_ssh_call(const char *request);
extern void csw_ssh_free(char *response);

@interface DirectSsh : NSObject <RCTBridgeModule>
@property(nonatomic, strong) dispatch_group_t calls;
@property(nonatomic) BOOL invalidated;
@property(nonatomic, copy) NSString *owner;
@end

@implementation DirectSsh
RCT_EXPORT_MODULE();
+ (BOOL)requiresMainQueueSetup { return NO; }
- (instancetype)init {
    if ((self = [super init])) {
        _calls = dispatch_group_create();
        _owner = [[NSUUID UUID] UUIDString];
    }
    return self;
}
- (void)invalidate {
    @synchronized(self) { _invalidated = YES; }
    dispatch_group_notify(_calls, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSString *request = [NSString stringWithFormat:@"{\"reset\":true,\"owner\":\"%@\"}", self.owner];
        char *reply = csw_ssh_call([request UTF8String]);
        csw_ssh_free(reply);
    });
}

RCT_EXPORT_METHOD(call:(NSString *)request resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    if (!request || request.length > 8 * 1024 * 1024) {
        reject(@"SSH_INVALID", @"client.ssh.invalid", nil); return;
    }
    @synchronized(self) {
        if (_invalidated) { reject(@"SSH_CLOSED", @"client.ssh.closed", nil); return; }
        dispatch_group_enter(_calls);
    }
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        id value = [NSJSONSerialization JSONObjectWithData:[request dataUsingEncoding:NSUTF8StringEncoding]
            options:NSJSONReadingMutableContainers error:NULL];
        if (![value isKindOfClass:[NSMutableDictionary class]]) {
            reject(@"SSH_INVALID", @"client.ssh.invalid", nil);
            dispatch_group_leave(self.calls); return;
        }
        value[@"owner"] = self.owner;
        NSData *encoded = [NSJSONSerialization dataWithJSONObject:value options:0 error:NULL];
        NSString *owned = [[NSString alloc] initWithData:encoded encoding:NSUTF8StringEncoding];
        char *response = csw_ssh_call([owned UTF8String]);
        NSString *reply = response ? [NSString stringWithUTF8String:response] : nil;
        csw_ssh_free(response);
        if (reply) resolve(reply);
        else reject(@"SSH_FAILED", @"client.ssh.connectionFailed", nil);
        dispatch_group_leave(self.calls);
    });
}
@end
