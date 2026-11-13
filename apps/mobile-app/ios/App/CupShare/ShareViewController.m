#import <UIKit/UIKit.h>
#import <UniformTypeIdentifiers/UniformTypeIdentifiers.h>

/**
 * The `CupShare` sheet. Choosing Cup in a Share Sheet is the whole share: the sheet reads the first
 * HTTP(S) URL from the shared items and hands it to Cup as an `audio.cup.app://share` link on its
 * own, once it is on screen. Its button opens Cup again, after a failed handoff or back in the
 * sharing app.
 */
@interface ShareViewController : UIViewController
@property(nonatomic, strong) UILabel *message;
@property(nonatomic, strong) UIButton *openButton;
@property(nonatomic, strong) NSURL *sharedURL;
/** Whether the sheet is on screen, where the responder chain reaches the object that opens URLs. */
@property(nonatomic) BOOL hasAppeared;
/** Whether the sheet has handed the shared URL to Cup on its own, which it does once. */
@property(nonatomic) BOOL hasOpenedCup;
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
    [self loadURLFromProviders:providers index:0 typeIndex:0];
}

- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    self.hasAppeared = YES;
    [self openInCupOnce];
}

/** The types a shared item is read as, in order: a URL, then text that may contain one. */
+ (NSArray<NSString *> *)readableTypes {
    return @[UTTypeURL.identifier, UTTypePlainText.identifier];
}

- (void)loadURLFromProviders:(NSArray<NSItemProvider *> *)providers index:(NSUInteger)index typeIndex:(NSUInteger)typeIndex {
    NSArray<NSString *> *types = ShareViewController.readableTypes;
    if (index >= providers.count) {
        self.message.text = @"Share a web page or text containing an HTTP or HTTPS URL.";
        return;
    }
    if (typeIndex >= types.count) {
        [self loadURLFromProviders:providers index:index + 1 typeIndex:0];
        return;
    }
    NSItemProvider *provider = providers[index];
    NSString *type = types[typeIndex];
    if (![provider hasItemConformingToTypeIdentifier:type]) {
        [self loadURLFromProviders:providers index:index typeIndex:typeIndex + 1];
        return;
    }
    [provider loadItemForTypeIdentifier:type options:nil completionHandler:^(id<NSSecureCoding> item, NSError *error) {
        if (error) {
            NSLog(@"CupShare could not read a shared item as %@: %@", type, error);
        }
        NSURL *url = error ? nil : [ShareViewController webURLFromItem:(id)item];
        dispatch_async(dispatch_get_main_queue(), ^{
            if (url) {
                self.sharedURL = url;
                // Credentials in trial-link fragments must not appear in the preview.
                self.message.text = [NSString stringWithFormat:@"Opening %@ in Cup…", url.host];
                [self openInCupOnce];
            } else {
                [self loadURLFromProviders:providers index:index typeIndex:typeIndex + 1];
            }
        });
    }];
}

/**
 * The HTTP(S) URL a shared item holds. Apps hand over a URL as an `NSURL`, as the data of one, or
 * as text, and text may hold the URL among other words, such as a page title.
 */
+ (NSURL *)webURLFromItem:(id)item {
    if ([item isKindOfClass:NSURL.class]) {
        return [self isWebURL:item] ? item : nil;
    }
    if ([item isKindOfClass:NSData.class]) {
        NSURL *url = [NSURL URLWithDataRepresentation:item relativeToURL:nil];
        if ([self isWebURL:url]) {
            return url;
        }
        NSString *text = [[NSString alloc] initWithData:item encoding:NSUTF8StringEncoding];
        return text ? [self webURLFromText:text] : nil;
    }
    if ([item isKindOfClass:NSString.class]) {
        return [self webURLFromText:item];
    }
    return nil;
}

+ (NSURL *)webURLFromText:(NSString *)text {
    NSDataDetector *detector = [NSDataDetector dataDetectorWithTypes:NSTextCheckingTypeLink error:nil];
    for (NSTextCheckingResult *match in [detector matchesInString:text options:0 range:NSMakeRange(0, text.length)]) {
        if ([self isWebURL:match.URL]) {
            return match.URL;
        }
    }
    return nil;
}

+ (BOOL)isWebURL:(NSURL *)url {
    return url.host.length > 0 && [@[@"http", @"https"] containsObject:url.scheme.lowercaseString] && !url.user.length && !url.password.length;
}

/** Hands the shared URL to Cup once both it is read and the sheet is on screen. */
- (void)openInCupOnce {
    if (!self.hasAppeared || !self.sharedURL || self.hasOpenedCup) return;
    self.hasOpenedCup = YES;
    [self openInCup];
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
                        // The sheet stays open, since dismissing it here could cut off iOS's
                        // foreground transition; back in the sharing app, the button opens Cup again.
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
    self.message.text = @"Cup could not open. Tap Open in Cup to try again.";
    self.openButton.enabled = YES;
}

- (void)cancel {
    [self.extensionContext completeRequestReturningItems:@[] completionHandler:nil];
}
@end
