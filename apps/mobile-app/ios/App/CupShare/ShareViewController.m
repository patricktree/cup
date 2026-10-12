#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

@interface ShareViewController : UIViewController
@property(nonatomic, strong) UILabel *message;
@property(nonatomic, strong) UIButton *openButton;
@property(nonatomic, strong) NSURL *sharedURL;
@end

@implementation ShareViewController
- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.systemBackgroundColor;
    self.preferredContentSize = CGSizeMake(420, 280);
    UILabel *title = [[UILabel alloc] init];
    title.text = @"Cup";
    title.font = [UIFont preferredFontForTextStyle:UIFontTextStyleTitle1];
    title.textAlignment = NSTextAlignmentCenter;
    self.message = [[UILabel alloc] init];
    self.message.text = @"Loading shared URL…";
    self.message.numberOfLines = 4;
    self.message.lineBreakMode = NSLineBreakByTruncatingMiddle;
    self.message.textAlignment = NSTextAlignmentCenter;
    self.message.font = [UIFont preferredFontForTextStyle:UIFontTextStyleBody];
    self.openButton = [UIButton buttonWithType:UIButtonTypeSystem];
    self.openButton.configuration = UIButtonConfiguration.filledButtonConfiguration;
    [self.openButton setTitle:@"Open in Cup" forState:UIControlStateNormal];
    self.openButton.enabled = NO;
    [self.openButton addTarget:self action:@selector(openInCup) forControlEvents:UIControlEventTouchUpInside];
    UIButton *cancel = [UIButton buttonWithType:UIButtonTypeSystem];
    [cancel setTitle:@"Cancel" forState:UIControlStateNormal];
    [cancel addTarget:self action:@selector(cancel) forControlEvents:UIControlEventTouchUpInside];
    UIStackView *stack = [[UIStackView alloc] initWithArrangedSubviews:@[title, self.message, self.openButton, cancel]];
    stack.axis = UILayoutConstraintAxisVertical;
    stack.spacing = 20;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [self.view addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
        [stack.leadingAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.leadingAnchor constant:24],
        [stack.trailingAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.trailingAnchor constant:-24],
        [stack.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor constant:24],
        [stack.bottomAnchor constraintLessThanOrEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor constant:-24]
    ]];
    NSMutableArray<NSItemProvider *> *providers = [NSMutableArray array];
    for (NSExtensionItem *item in self.extensionContext.inputItems) {
        [providers addObjectsFromArray:item.attachments ?: @[]];
    }
    [self loadURLFromProviders:providers index:0];
}

- (void)loadURLFromProviders:(NSArray<NSItemProvider *> *)providers index:(NSUInteger)index {
    if (index >= providers.count) {
        self.message.text = @"Share a web page or text containing an HTTP or HTTPS URL.";
        return;
    }
    NSItemProvider *provider = providers[index];
    NSString *type = [provider hasItemConformingToTypeIdentifier:UTTypeURL.identifier] ? UTTypeURL.identifier : UTTypePlainText.identifier;
    if (![provider hasItemConformingToTypeIdentifier:type]) {
        [self loadURLFromProviders:providers index:index + 1];
        return;
    }
    [provider loadItemForTypeIdentifier:type options:nil completionHandler:^(id<NSSecureCoding> item, NSError *error) {
        NSURL *url = [(id)item isKindOfClass:NSURL.class] ? (NSURL *)item : nil;
        if ([(id)item isKindOfClass:NSString.class]) {
            NSString *text = (NSString *)item;
            NSDataDetector *detector = [NSDataDetector dataDetectorWithTypes:NSTextCheckingTypeLink error:nil];
            for (NSTextCheckingResult *match in [detector matchesInString:text options:0 range:NSMakeRange(0, text.length)]) {
                if ([@[@"http", @"https"] containsObject:match.URL.scheme.lowercaseString]) {
                    url = match.URL;
                    break;
                }
            }
        }
        BOOL valid = url.host.length > 0 && [@[@"http", @"https"] containsObject:url.scheme.lowercaseString] && !url.user.length && !url.password.length;
        dispatch_async(dispatch_get_main_queue(), ^{
            if (valid && !error) {
                self.sharedURL = url;
                // Credentials in trial-link fragments must not appear in the preview.
                self.message.text = url.host;
                self.openButton.enabled = YES;
            } else {
                [self loadURLFromProviders:providers index:index + 1];
            }
        });
    }];
}

- (void)openInCup {
    if (!self.sharedURL) return;
    NSURLComponents *components = [[NSURLComponents alloc] init];
    components.scheme = @"audio.cup.app";
    components.host = @"share";
    components.queryItems = @[[NSURLQueryItem queryItemWithName:@"url" value:self.sharedURL.absoluteString]];
    // URLSearchParams treats unescaped plus signs as spaces.
    components.percentEncodedQuery = [components.percentEncodedQuery stringByReplacingOccurrencesOfString:@"+" withString:@"%2B"];
    NSURL *url = components.URL;
    self.openButton.enabled = NO;
    // Chrome uses this responder-chain handoff. Apple does not support it for Share Extensions.
    // https://chromium.googlesource.com/chromium/src/+/main/ios/chrome/common/extension_open_url.mm
    SEL selector = NSSelectorFromString(@"openURL:options:completionHandler:");
    UIResponder *responder = self.nextResponder;
    while (responder) {
        if ([responder respondsToSelector:selector]) {
            NSInvocation *invocation = [NSInvocation invocationWithMethodSignature:[responder methodSignatureForSelector:selector]];
            invocation.target = responder;
            invocation.selector = selector;
            // UIScene and UIApplication share this selector but use different options types.
            // Like Chromium, pass nil so either responder can apply its defaults.
            id options = nil;
            void (^completion)(BOOL) = ^(BOOL success) {
                dispatch_async(dispatch_get_main_queue(), ^{
                    if (success) {
                        // Let iOS finish the foreground transition before dismissing this extension.
                        self.openButton.enabled = YES;
                    } else {
                        [self showOpenFailure];
                    }
                });
            };
            [invocation setArgument:&url atIndex:2];
            [invocation setArgument:&options atIndex:3];
            [invocation setArgument:&completion atIndex:4];
            [invocation retainArguments];
            [invocation invoke];
            return;
        }
        responder = responder.nextResponder;
    }
    [self showOpenFailure];
}

- (void)showOpenFailure {
    self.message.text = @"Cup could not open. Cancel and try sharing again.";
    self.openButton.enabled = YES;
}

- (void)cancel {
    [self.extensionContext completeRequestReturningItems:@[] completionHandler:nil];
}
@end
